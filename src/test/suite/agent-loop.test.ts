// ============================================================================
// AgentLoop Unit Tests
// Tests the iterative tool calling loop with mock providers and tool executors.
// ============================================================================

import * as assert from 'assert';
import * as sinon from 'sinon';
import { AgentLoop, AgentLoopResult } from '../../engine/agent-loop';
import { EventBus } from '../../core/event-bus';
import { StateManager } from '../../core/state-manager';
import { ToolExecutor, TOOL_DEFINITIONS } from '../../tools/ide-tools';
import { CortexProvider, Message, Token, ToolCallDelta, ToolDefinition, StreamOptions, ContextFile } from '../../core/types';

// --- Helpers ---

/**
 * Create a mock CortexProvider that yields the given chunks on each call.
 * `callChunks` is an array-of-arrays: callChunks[i] = chunks for the i-th stream() call.
 */
function createMockProvider(
    callChunks: Array<Array<Token | ToolCallDelta>>
): CortexProvider {
    let callIndex = 0;

    return {
        name: 'mock-model',
        maxContextWindow: 128000,
        supportsThinking: false,
        countTokens: (text: string) => Math.ceil(text.length / 3.5),
        stream: async function* (
            _messages: Message[],
            _systemPrompt: string,
            _tools: ToolDefinition[],
            _signal: AbortSignal,
            _options?: StreamOptions
        ): AsyncGenerator<Token | ToolCallDelta> {
            const chunks = callChunks[callIndex] || [];
            callIndex++;
            for (const chunk of chunks) {
                yield chunk;
            }
        },
    };
}

/**
 * Create a mock ToolExecutor that returns a fixed result for any tool call.
 */
function createMockToolExecutor(
    results?: Record<string, string>
): ToolExecutor {
    return {
        execute: async (toolName: string, _args: any, _messageId: string, toolCallId?: string) => {
            const content = results?.[toolName] ?? `Result from ${toolName}`;
            return {
                toolCallId: toolCallId || `tc_${Date.now()}`,
                content,
                isError: false,
            };
        },
    } as any;
}

function createMinimalMessages(): Message[] {
    return [{ role: 'user', content: 'test prompt', timestamp: Date.now() }];
}

suite('AgentLoop', () => {
    let eventBus: EventBus;
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        eventBus = new EventBus();

        // Stub vscode.workspace.getConfiguration for maxIterations
        const vscode = require('vscode');
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: (key: string, defaultValue: any) => {
                if (key === 'agentLoop.maxIterations') return 15;
                return defaultValue;
            },
        });
    });

    teardown(() => {
        eventBus.removeAll();
        sandbox.restore();
    });

    test('returns final content when provider returns no tool calls (single iteration)', async () => {
        const provider = createMockProvider([
            [
                { text: 'Hello, ', type: 'content' } as Token,
                { text: 'world!', type: 'content' } as Token,
            ],
        ]);

        const toolExecutor = createMockToolExecutor();
        const stateManager = {} as StateManager; // Not used for this path
        const loop = new AgentLoop(eventBus, stateManager, toolExecutor);

        const result = await loop.run(
            provider,
            createMinimalMessages(),
            'System prompt',
            [],
            new AbortController().signal,
            'msg_test'
        );

        assert.strictEqual(result.finalContent, 'Hello, world!');
        assert.strictEqual(result.iterations, 1);
        assert.strictEqual(result.toolCallsMade, 0);
    });

    test('executes tool calls and loops correctly', async () => {
        // First call: provider returns a tool call
        // Second call: provider returns final text (no tools)
        const provider = createMockProvider([
            // Iteration 1: text + tool call
            [
                { text: 'Let me read the file.', type: 'content' } as Token,
                {
                    type: 'tool_call',
                    toolCall: { id: 'tc_1', name: 'read_file', arguments: { path: 'test.ts' } },
                } as ToolCallDelta,
            ],
            // Iteration 2: final response
            [
                { text: 'Here is the file content.', type: 'content' } as Token,
            ],
        ]);

        const toolExecutor = createMockToolExecutor({
            read_file: 'console.log("hello");',
        });
        const stateManager = {} as StateManager;
        const loop = new AgentLoop(eventBus, stateManager, toolExecutor);

        const result = await loop.run(
            provider,
            createMinimalMessages(),
            'System prompt',
            [],
            new AbortController().signal,
            'msg_test'
        );

        assert.strictEqual(result.finalContent, 'Here is the file content.');
        assert.strictEqual(result.iterations, 2);
        assert.strictEqual(result.toolCallsMade, 1);
    });

    test('stops at maxIterations', async () => {
        // Override maxIterations to 2
        const vscode = require('vscode');
        (vscode.workspace.getConfiguration as sinon.SinonStub).returns({
            get: (key: string, defaultValue: any) => {
                if (key === 'agentLoop.maxIterations') return 2;
                return defaultValue;
            },
        });

        // Provider always returns tool calls (never a final response)
        const infiniteProvider = createMockProvider([
            [
                { type: 'tool_call', toolCall: { id: 'tc_1', name: 'read_file', arguments: { path: 'a.ts' } } } as ToolCallDelta,
            ],
            [
                { type: 'tool_call', toolCall: { id: 'tc_2', name: 'read_file', arguments: { path: 'b.ts' } } } as ToolCallDelta,
            ],
            // Third won't be reached
            [
                { text: 'Done!', type: 'content' } as Token,
            ],
        ]);

        const toolExecutor = createMockToolExecutor();
        const stateManager = {} as StateManager;
        const loop = new AgentLoop(eventBus, stateManager, toolExecutor);

        const result = await loop.run(
            infiniteProvider,
            createMinimalMessages(),
            'System prompt',
            [],
            new AbortController().signal,
            'msg_test'
        );

        assert.strictEqual(result.iterations, 2);
        assert.ok(result.finalContent.includes('maximum'));
    });

    test('abort signal cancels the loop', async () => {
        const abortController = new AbortController();

        // Provider that yields one token then aborts before the check at top of loop
        const provider: CortexProvider = {
            name: 'mock',
            maxContextWindow: 128000,
            supportsThinking: false,
            countTokens: () => 0,
            stream: async function* () {
                yield { text: 'start', type: 'content' } as Token;
                // Abort mid-stream
                abortController.abort();
                yield { text: ' more', type: 'content' } as Token;
            },
        };

        const toolExecutor = createMockToolExecutor();
        const stateManager = {} as StateManager;
        const loop = new AgentLoop(eventBus, stateManager, toolExecutor);

        // The loop should resolve (not hang) after abort.
        // It may resolve with partial content or throw — both are acceptable.
        try {
            const result = await loop.run(
                provider,
                createMinimalMessages(),
                'System prompt',
                [],
                abortController.signal,
                'msg_test'
            );
            // If it resolved, it should have partial content (only 'start' before abort)
            assert.ok(result.iterations >= 1);
        } catch (err: any) {
            // If it threw, it should be a cancellation error
            assert.ok(err.message.toLowerCase().includes('cancel'));
        }
    });

    test('collects thinking tokens separately', async () => {
        const provider = createMockProvider([
            [
                { text: 'Let me think...', type: 'reasoning' } as Token,
                { text: 'The answer is 42.', type: 'content' } as Token,
            ],
        ]);

        const toolExecutor = createMockToolExecutor();
        const stateManager = {} as StateManager;
        const loop = new AgentLoop(eventBus, stateManager, toolExecutor);

        const result = await loop.run(
            provider,
            createMinimalMessages(),
            'System prompt',
            [],
            new AbortController().signal,
            'msg_test'
        );

        assert.strictEqual(result.finalContent, 'The answer is 42.');
        assert.strictEqual(result.thinking, 'Let me think...');
    });

    test('emits STREAM_CONTENT and STREAM_THINKING events', async () => {
        const provider = createMockProvider([
            [
                { text: 'think', type: 'reasoning' } as Token,
                { text: 'answer', type: 'content' } as Token,
            ],
        ]);

        const contentTokens: string[] = [];
        const thinkingTokens: string[] = [];

        eventBus.on('STREAM_CONTENT', (event: any) => {
            contentTokens.push(event.payload.token);
        });
        eventBus.on('STREAM_THINKING', (event: any) => {
            thinkingTokens.push(event.payload.token);
        });

        const toolExecutor = createMockToolExecutor();
        const stateManager = {} as StateManager;
        const loop = new AgentLoop(eventBus, stateManager, toolExecutor);

        await loop.run(
            provider,
            createMinimalMessages(),
            'System prompt',
            [],
            new AbortController().signal,
            'msg_test'
        );

        assert.deepStrictEqual(contentTokens, ['answer']);
        assert.deepStrictEqual(thinkingTokens, ['think']);
    });

    test('tool confirmation denied sends denial to LLM', async () => {
        // Provider returns a write_file tool call, then final text
        const provider = createMockProvider([
            [
                {
                    type: 'tool_call',
                    toolCall: { id: 'tc_write', name: 'write_file', arguments: { path: 'x.ts', content: 'new' } },
                } as ToolCallDelta,
            ],
            // Iteration 2: final response after denied tool
            [
                { text: 'OK, I will not write.', type: 'content' } as Token,
            ],
        ]);

        const toolExecutor = createMockToolExecutor();
        const stateManager = {} as StateManager;
        const loop = new AgentLoop(eventBus, stateManager, toolExecutor);

        // Auto-deny the confirmation after a short delay
        eventBus.on('TOOL_CONFIRM_REQUEST', (event: any) => {
            setTimeout(() => {
                eventBus.emit('TOOL_CONFIRM_RESPONSE', {
                    toolCallId: event.payload.toolCallId,
                    approved: false,
                });
            }, 10);
        });

        const result = await loop.run(
            provider,
            createMinimalMessages(),
            'System prompt',
            [],
            new AbortController().signal,
            'msg_test'
        );

        assert.strictEqual(result.finalContent, 'OK, I will not write.');
        // Tool was denied, so only 1 "attempted" tool call counted
        assert.strictEqual(result.toolCallsMade, 1);
    });

    test('tool confirmation approved executes the tool', async () => {
        const provider = createMockProvider([
            [
                {
                    type: 'tool_call',
                    toolCall: { id: 'tc_write', name: 'write_file', arguments: { path: 'x.ts', content: 'new' } },
                } as ToolCallDelta,
            ],
            [
                { text: 'File written successfully.', type: 'content' } as Token,
            ],
        ]);

        let toolExecuted = false;
        const toolExecutor = {
            execute: async () => {
                toolExecuted = true;
                return { toolCallId: 'tc_write', content: 'Written', isError: false };
            },
        } as any;

        const stateManager = {} as StateManager;
        const loop = new AgentLoop(eventBus, stateManager, toolExecutor);

        // Auto-approve confirmation
        eventBus.on('TOOL_CONFIRM_REQUEST', (event: any) => {
            setTimeout(() => {
                eventBus.emit('TOOL_CONFIRM_RESPONSE', {
                    toolCallId: event.payload.toolCallId,
                    approved: true,
                });
            }, 10);
        });

        const result = await loop.run(
            provider,
            createMinimalMessages(),
            'System prompt',
            [],
            new AbortController().signal,
            'msg_test'
        );

        assert.ok(toolExecuted);
        assert.strictEqual(result.finalContent, 'File written successfully.');
    });

    test('context files are included in system prompt', async () => {
        let capturedSystemPrompt = '';

        const provider: CortexProvider = {
            name: 'mock',
            maxContextWindow: 128000,
            supportsThinking: false,
            countTokens: () => 0,
            stream: async function* (
                _messages: Message[],
                systemPrompt: string,
            ) {
                capturedSystemPrompt = systemPrompt;
                yield { text: 'done', type: 'content' } as Token;
            },
        };

        const contextFiles: ContextFile[] = [
            { filePath: 'src/app.ts', content: 'const x = 1;', relevanceScore: 0.9 },
        ];

        const toolExecutor = createMockToolExecutor();
        const stateManager = {} as StateManager;
        const loop = new AgentLoop(eventBus, stateManager, toolExecutor);

        await loop.run(
            provider,
            createMinimalMessages(),
            'You are Cortex.',
            contextFiles,
            new AbortController().signal,
            'msg_test'
        );

        assert.ok(capturedSystemPrompt.includes('src/app.ts'));
        assert.ok(capturedSystemPrompt.includes('const x = 1;'));
    });
});

// ============================================================================
// Agent Loop — Iterative Tool Calling
// Triggered when classifier says needsTools: true.
// Max iterations configurable (default 15). Full undo coverage.
// Error recovery: retry on malformed tool calls, skip on tool failure.
// ============================================================================

import * as vscode from 'vscode';
import {
  CortexProvider, Message, Token, ToolCallDelta,
  ToolDefinition, StreamOptions, ContextFile,
} from '../core/types';
import { EventBus } from '../core/event-bus';
import { StateManager } from '../core/state-manager';
import { ToolExecutor, TOOL_DEFINITIONS } from '../tools/ide-tools';

export interface AgentLoopResult {
  finalContent: string;
  thinking: string;
  iterations: number;
  toolCallsMade: number;
}

export class AgentLoop {
  private eventBus: EventBus;
  private stateManager: StateManager;
  private toolExecutor: ToolExecutor;

  constructor(
    eventBus: EventBus,
    stateManager: StateManager,
    toolExecutor: ToolExecutor
  ) {
    this.eventBus = eventBus;
    this.stateManager = stateManager;
    this.toolExecutor = toolExecutor;
  }

  async run(
    provider: CortexProvider,
    messages: Message[],
    systemPrompt: string,
    contextFiles: ContextFile[],
    signal: AbortSignal,
    messageId: string,
    options?: StreamOptions
  ): Promise<AgentLoopResult> {
    const config = vscode.workspace.getConfiguration('cortex');
    const maxIterations = config.get<number>('agentLoop.maxIterations', 15);

    // Build system prompt with context
    const contextBlock = contextFiles
      .map((f) => `--- ${f.filePath} ---\n${f.content}`)
      .join('\n\n');

    const fullSystemPrompt = [
      systemPrompt,
      contextBlock ? `\n\nRelevant code context:\n${contextBlock}` : '',
    ].join('');

    // Copy messages for agent loop (we'll append tool results)
    const loopMessages = [...messages];

    let finalContent = '';
    let thinking = '';
    let iterations = 0;
    let toolCallsMade = 0;

    const tools: ToolDefinition[] = TOOL_DEFINITIONS;

    // Build lookup map for tool definitions (O(1) access for requiresConfirmation check)
    const toolDefsMap = new Map(tools.map(t => [t.name, t]));

    while (iterations < maxIterations) {
      if (signal.aborted) {
        throw new Error('Request cancelled');
      }

      iterations++;
      let iterationContent = '';
      let iterationThinking = '';
      const pendingToolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];

      // Stream from provider
      const streamOptions: StreamOptions | undefined = options;

      const stream = provider.stream(
        loopMessages,
        fullSystemPrompt,
        tools,
        signal,
        streamOptions
      );

      for await (const chunk of stream) {
        if (signal.aborted) break;

        if ('type' in chunk && chunk.type === 'tool_call') {
          // Tool call received
          const tc = (chunk as ToolCallDelta).toolCall;
          pendingToolCalls.push(tc);
        } else {
          // Token received
          const token = chunk as Token;
          if (token.type === 'reasoning') {
            iterationThinking += token.text;
            this.eventBus.emit('STREAM_THINKING', {
              token: token.text,
              type: 'reasoning',
              messageId,
            });
          } else {
            iterationContent += token.text;
            this.eventBus.emit('STREAM_CONTENT', {
              token: token.text,
              type: 'content',
              messageId,
            });
          }
        }
      }

      thinking += iterationThinking;

      // If no tool calls, this is the final response
      if (pendingToolCalls.length === 0) {
        finalContent = iterationContent;
        break;
      }

      // Execute tool calls
      // Add assistant message with tool calls to history
      loopMessages.push({
        role: 'assistant',
        content: iterationContent,
        thinking: iterationThinking,
        toolCalls: pendingToolCalls,
        timestamp: Date.now(),
      });

      for (const tc of pendingToolCalls) {
        toolCallsMade++;

        // Check if tool requires user confirmation
        const toolDef = toolDefsMap.get(tc.name);
        const needsConfirm = toolDef?.requiresConfirmation === true;

        if (needsConfirm) {
          // Emit confirmation request to sidebar UI
          this.eventBus.emit('TOOL_CONFIRM_REQUEST', {
            toolCallId: tc.id,
            tool: tc.name,
            args: tc.arguments,
            messageId,
          });

          // Wait for user response
          const approved = await this.waitForConfirmation(tc.id, signal);

          if (!approved) {
            // User denied — add denied result and continue loop
            loopMessages.push({
              role: 'tool',
              content: `Tool "${tc.name}" was denied by the user.`,
              toolResults: [{
                toolCallId: tc.id,
                content: `Tool "${tc.name}" was denied by the user.`,
                isError: true,
              }],
              timestamp: Date.now(),
            });
            continue;
          }
        }

        // Emit event for UI
        this.eventBus.emit('TOOL_REQUEST', {
          tool: tc.name,
          args: tc.arguments,
          iterationIndex: iterations,
        });

        // Notify sidebar about agent iteration
        this.eventBus.emit('STREAM_CONTENT', {
          token: '',
          type: 'content',
          messageId,
          agentIteration: {
            iteration: iterations,
            maxIterations,
            toolName: tc.name,
          },
        });

        // Execute the tool
        const result = await this.toolExecutor.execute(tc.name, tc.arguments, messageId, tc.id);

        // Emit result
        this.eventBus.emit('TOOL_RESULT', {
          result: result.content,
          toolId: tc.id,
          isError: result.isError || false,
        });

        // Add tool result to messages
        loopMessages.push({
          role: 'tool',
          content: result.content,
          toolResults: [result],
          timestamp: Date.now(),
        });
      }
    }

    if (iterations >= maxIterations && !finalContent) {
      finalContent = `[Agent loop reached maximum ${maxIterations} iterations. Partial results may have been applied via tool calls.]`;
    }

    return {
      finalContent,
      thinking,
      iterations,
      toolCallsMade,
    };
  }

  /**
   * Wait for user confirmation via TOOL_CONFIRM_RESPONSE event.
   * Returns true if approved, false if denied or aborted.
   */
  private waitForConfirmation(toolCallId: string, signal: AbortSignal): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      // Listen for response matching this toolCallId
      const unsubscribe = this.eventBus.on('TOOL_CONFIRM_RESPONSE', (event: any) => {
        if (event.payload.toolCallId === toolCallId) {
          unsubscribe();
          resolve(event.payload.approved === true);
        }
      });

      // Also resolve on abort so we don't hang forever
      const onAbort = () => {
        unsubscribe();
        resolve(false);
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}

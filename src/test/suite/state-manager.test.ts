// ============================================================================
// StateManager Unit Tests
// Tests conversation management, message history, and action stack.
// Uses a mock vscode.ExtensionContext (workspaceState).
// ============================================================================

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { StateManager } from '../../core/state-manager';
import { Message, AIAction } from '../../core/types';

/**
 * Create a minimal mock ExtensionContext with an in-memory workspaceState.
 */
function createMockContext(): vscode.ExtensionContext {
    const store = new Map<string, any>();

    const workspaceState: vscode.Memento = {
        get<T>(key: string, defaultValue?: T): T {
            return store.has(key) ? store.get(key) : (defaultValue as T);
        },
        update(key: string, value: any): Thenable<void> {
            store.set(key, value);
            return Promise.resolve();
        },
        keys(): readonly string[] {
            return [...store.keys()];
        },
    };

    const globalState = {
        ...workspaceState,
        setKeysForSync(_keys: readonly string[]): void { /* noop */ },
    };

    return {
        workspaceState,
        subscriptions: [],
        globalState,
        extensionPath: '',
        extensionUri: vscode.Uri.parse('file:///test'),
        storagePath: null,
        globalStoragePath: '',
        logPath: '',
        extensionMode: vscode.ExtensionMode.Test,
        storageUri: null,
        globalStorageUri: vscode.Uri.parse('file:///test'),
        logUri: vscode.Uri.parse('file:///test'),
        extension: {} as any,
        asAbsolutePath: (p: string) => p,
        environmentVariableCollection: {} as any,
        secrets: {} as any,
        languageModelAccessInformation: {} as any,
    } as unknown as vscode.ExtensionContext;
}

suite('StateManager', () => {
    let stateManager: StateManager;
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        // Stub vscode.commands.executeCommand to prevent real context key setting
        sandbox.stub(vscode.commands, 'executeCommand').resolves();
        // Stub window events to prevent real subscriptions
        sandbox.stub(vscode.window, 'onDidChangeActiveTextEditor').returns({ dispose: () => { } });
        sandbox.stub(vscode.window, 'onDidChangeTextEditorSelection').returns({ dispose: () => { } });
        // Stub activeTextEditor 
        sandbox.stub(vscode.window, 'activeTextEditor').value(undefined);

        const mockContext = createMockContext();
        stateManager = new StateManager(mockContext);
    });

    teardown(() => {
        stateManager.dispose();
        sandbox.restore();
    });

    // --- Conversation Management ---

    test('constructor creates a default conversation', () => {
        const convs = stateManager.getConversations();
        assert.strictEqual(convs.length, 1);
        assert.ok(stateManager.getActiveConversationId());
    });

    test('createConversation creates and activates new conversation', () => {
        const conv = stateManager.createConversation('Test Chat');
        assert.strictEqual(conv.title, 'Test Chat');
        assert.strictEqual(stateManager.getActiveConversationId(), conv.id);
        assert.strictEqual(stateManager.getConversations().length, 2);
    });

    test('switchConversation changes active conversation', () => {
        const conv1 = stateManager.getConversations()[0];
        const conv2 = stateManager.createConversation('Second');

        stateManager.switchConversation(conv1.id);
        assert.strictEqual(stateManager.getActiveConversationId(), conv1.id);

        stateManager.switchConversation(conv2.id);
        assert.strictEqual(stateManager.getActiveConversationId(), conv2.id);
    });

    test('switchConversation returns false for non-existent id', () => {
        const result = stateManager.switchConversation('nonexistent_id');
        assert.strictEqual(result, false);
    });

    test('deleteConversation removes conversation and picks next', () => {
        const conv1 = stateManager.getConversations()[0];
        const conv2 = stateManager.createConversation('Second');

        // Delete the active one (conv2)
        const nextId = stateManager.deleteConversation(conv2.id);
        assert.ok(nextId);
        assert.strictEqual(stateManager.getConversations().length, 1);
        assert.strictEqual(stateManager.getActiveConversationId(), conv1.id);
    });

    test('deleteConversation creates new conv if last one deleted', () => {
        const convs = stateManager.getConversations();
        assert.strictEqual(convs.length, 1);

        const nextId = stateManager.deleteConversation(convs[0].id);
        assert.ok(nextId);
        assert.strictEqual(stateManager.getConversations().length, 1);
        // Should be a new conversation
        assert.notStrictEqual(nextId, convs[0].id);
    });

    test('deleteConversation returns undefined for non-existent id', () => {
        const result = stateManager.deleteConversation('nonexistent');
        assert.strictEqual(result, undefined);
    });

    // --- Message History ---

    test('addMessage stores message in active conversation', () => {
        const msg: Message = {
            role: 'user',
            content: 'Hello AI',
            timestamp: Date.now(),
        };
        stateManager.addMessage(msg);

        const messages = stateManager.getMessages();
        assert.strictEqual(messages.length, 1);
        assert.strictEqual(messages[0].content, 'Hello AI');
    });

    test('addMessage auto-updates title from first user message', () => {
        const msg: Message = {
            role: 'user',
            content: 'Fix the login bug in auth.ts',
            timestamp: Date.now(),
        };
        stateManager.addMessage(msg);

        const convs = stateManager.getConversations();
        const active = convs.find((c) => c.id === stateManager.getActiveConversationId());
        assert.ok(active);
        assert.strictEqual(active!.title, 'Fix the login bug in auth.ts');
    });

    test('addMessage truncates long title to 40 chars + ellipsis', () => {
        const longPrompt = 'A'.repeat(60);
        stateManager.addMessage({
            role: 'user',
            content: longPrompt,
            timestamp: Date.now(),
        });

        const convs = stateManager.getConversations();
        const active = convs.find((c) => c.id === stateManager.getActiveConversationId());
        assert.ok(active!.title.length <= 41); // 40 chars + '…'
        assert.ok(active!.title.endsWith('…'));
    });

    test('getRecentMessages returns last N messages', () => {
        for (let i = 0; i < 5; i++) {
            stateManager.addMessage({
                role: 'user',
                content: `Message ${i}`,
                timestamp: Date.now(),
            });
        }

        const recent = stateManager.getRecentMessages(3);
        assert.strictEqual(recent.length, 3);
        assert.strictEqual(recent[0].content, 'Message 2');
        assert.strictEqual(recent[2].content, 'Message 4');
    });

    test('clearMessages empties current conversation', () => {
        stateManager.addMessage({ role: 'user', content: 'test', timestamp: Date.now() });
        assert.strictEqual(stateManager.getMessages().length, 1);

        stateManager.clearMessages();
        assert.strictEqual(stateManager.getMessages().length, 0);
    });

    // --- AI Action Stack ---

    test('pushAction and popAction maintain LIFO order', () => {
        const action1: AIAction = {
            id: 'a1', timestamp: Date.now(), type: 'replace',
            files: ['file1.ts'], snapshot: new Map([['file1.ts', 'old']]),
            messageId: 'msg1',
        };
        const action2: AIAction = {
            id: 'a2', timestamp: Date.now(), type: 'insert',
            files: ['file2.ts'], snapshot: new Map([['file2.ts', 'old2']]),
            messageId: 'msg2',
        };

        stateManager.pushAction(action1);
        stateManager.pushAction(action2);

        assert.strictEqual(stateManager.getActionStackSize(), 2);

        const popped = stateManager.popAction();
        assert.strictEqual(popped?.id, 'a2');
        assert.strictEqual(stateManager.getActionStackSize(), 1);
    });

    test('popAction returns undefined when stack is empty', () => {
        const result = stateManager.popAction();
        assert.strictEqual(result, undefined);
    });

    test('getLastAction returns top of stack without removing', () => {
        const action: AIAction = {
            id: 'a1', timestamp: Date.now(), type: 'replace',
            files: ['f.ts'], snapshot: new Map(), messageId: 'msg1',
        };
        stateManager.pushAction(action);

        assert.strictEqual(stateManager.getLastAction()?.id, 'a1');
        assert.strictEqual(stateManager.getActionStackSize(), 1); // Not removed
    });

    test('getActionsForMessage filters by messageId', () => {
        stateManager.pushAction({
            id: 'a1', timestamp: 1, type: 'replace',
            files: [], snapshot: new Map(), messageId: 'msg1',
        });
        stateManager.pushAction({
            id: 'a2', timestamp: 2, type: 'insert',
            files: [], snapshot: new Map(), messageId: 'msg2',
        });
        stateManager.pushAction({
            id: 'a3', timestamp: 3, type: 'replace',
            files: [], snapshot: new Map(), messageId: 'msg1',
        });

        const msg1Actions = stateManager.getActionsForMessage('msg1');
        assert.strictEqual(msg1Actions.length, 2);
        assert.ok(msg1Actions.every((a) => a.messageId === 'msg1'));
    });

    // --- Conversation List ---

    test('getConversationList returns sorted by updatedAt desc', async () => {
        // First conv was created in setup
        const conv1 = stateManager.getConversations()[0];
        const conv2 = stateManager.createConversation('Newer');

        // Wait a small tick to ensure updatedAt differs
        await new Promise((resolve) => setTimeout(resolve, 5));

        // Add a message to conv2 so its updatedAt is strictly newer
        stateManager.addMessage({ role: 'user', content: 'hello', timestamp: Date.now() });

        const list = stateManager.getConversationList();
        // conv2 should be first because it has a newer updatedAt from the message
        assert.strictEqual(list.length, 2);
        assert.strictEqual(list[0].title, 'hello'); // conv2 title updated from message
    });

    test('getConversationList includes messageCount', () => {
        stateManager.addMessage({ role: 'user', content: 'hi', timestamp: Date.now() });
        stateManager.addMessage({ role: 'assistant', content: 'hello', timestamp: Date.now() });

        const list = stateManager.getConversationList();
        const active = list.find((c) => c.id === stateManager.getActiveConversationId());
        assert.strictEqual(active?.messageCount, 2);
    });
});

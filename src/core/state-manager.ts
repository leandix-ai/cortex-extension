// ============================================================================
// State Manager — Conversation History & Active Context
// Supports multiple conversations: create, switch, delete, list.
// Persists to workspace storage on IDE close.
// ============================================================================

import * as vscode from 'vscode';
import { Message, AIAction, Conversation } from './types';

export class StateManager {
  private conversations: Conversation[] = [];
  private activeConversationId: string = '';
  private actionStack: AIAction[] = [];
  private activeFilePath: string | undefined;
  private activeSelection: string | undefined;
  private context: vscode.ExtensionContext;
  private disposables: vscode.Disposable[] = [];

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.restoreState();

    // Track active file
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.activeFilePath = editor.document.uri.fsPath;
        }
      })
    );

    // Track selection
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((e) => {
        const sel = e.selections[0];
        if (!sel.isEmpty) {
          this.activeSelection = e.textEditor.document.getText(sel);
        } else {
          this.activeSelection = undefined;
        }
      })
    );

    // Set initial active file
    if (vscode.window.activeTextEditor) {
      this.activeFilePath = vscode.window.activeTextEditor.document.uri.fsPath;
    }
  }

  // --- Conversation Management ---

  private generateId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private getActiveConversation(): Conversation | undefined {
    return this.conversations.find((c) => c.id === this.activeConversationId);
  }

  createConversation(title?: string): Conversation {
    const now = Date.now();
    const conv: Conversation = {
      id: this.generateId(),
      title: title || `Chat ${this.conversations.length + 1}`,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    this.conversations.push(conv);
    this.activeConversationId = conv.id;
    return conv;
  }

  getConversations(): Conversation[] {
    return [...this.conversations];
  }

  getConversationList(): Array<{ id: string; title: string; createdAt: number; updatedAt: number; messageCount: number }> {
    return [...this.conversations]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        messageCount: c.messages.length,
      }));
  }

  switchConversation(id: string): boolean {
    const conv = this.conversations.find((c) => c.id === id);
    if (!conv) return false;
    this.activeConversationId = id;
    return true;
  }

  deleteConversation(id: string): string | undefined {
    const idx = this.conversations.findIndex((c) => c.id === id);
    if (idx === -1) return undefined;

    this.conversations.splice(idx, 1);

    // If we deleted the active conversation, switch to another or create new
    if (this.activeConversationId === id) {
      if (this.conversations.length > 0) {
        // Pick the most recent remaining conversation
        const next = [...this.conversations].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        this.activeConversationId = next.id;
        return next.id;
      } else {
        // No conversations left — create a blank one
        const newConv = this.createConversation();
        return newConv.id;
      }
    }

    return this.activeConversationId;
  }

  getActiveConversationId(): string {
    return this.activeConversationId;
  }

  // Update conversation title based on first user message
  private updateConversationTitle(): void {
    const conv = this.getActiveConversation();
    if (!conv) return;
    const firstUserMsg = conv.messages.find((m) => m.role === 'user');
    if (firstUserMsg) {
      const raw = firstUserMsg.content.trim();
      conv.title = raw.length > 40 ? raw.slice(0, 40) + '…' : raw;
    }
  }

  // --- Message History ---

  addMessage(message: Message): void {
    const conv = this.getActiveConversation();
    if (!conv) return;
    conv.messages.push(message);
    conv.updatedAt = Date.now();
    // Auto-update title from first user message
    if (message.role === 'user' && conv.messages.filter((m) => m.role === 'user').length === 1) {
      this.updateConversationTitle();
    }
  }

  getMessages(): Message[] {
    return [...(this.getActiveConversation()?.messages ?? [])];
  }

  getRecentMessages(count: number): Message[] {
    return this.getMessages().slice(-count);
  }

  clearMessages(): void {
    const conv = this.getActiveConversation();
    if (conv) conv.messages = [];
  }

  // --- Active Context ---

  getActiveFilePath(): string | undefined {
    return this.activeFilePath;
  }

  getActiveSelection(): string | undefined {
    return this.activeSelection;
  }

  getActiveFileContent(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return undefined;
    return editor.document.getText();
  }

  getActiveLanguage(): string | undefined {
    return vscode.window.activeTextEditor?.document.languageId;
  }

  // --- AI Action Stack ---

  pushAction(action: AIAction): void {
    this.actionStack.push(action);
    vscode.commands.executeCommand(
      'setContext', 'cortex.hasUndoableActions', this.actionStack.length > 0
    );
  }

  popAction(): AIAction | undefined {
    const action = this.actionStack.pop();
    vscode.commands.executeCommand(
      'setContext', 'cortex.hasUndoableActions', this.actionStack.length > 0
    );
    return action;
  }

  getLastAction(): AIAction | undefined {
    return this.actionStack[this.actionStack.length - 1];
  }

  getActionStackSize(): number {
    return this.actionStack.length;
  }

  getActionsForMessage(messageId: string): AIAction[] {
    return this.actionStack.filter((a) => a.messageId === messageId);
  }

  // --- Persistence ---

  persistState(): void {
    try {
      this.context.workspaceState.update('cortex.conversations', this.conversations);
      this.context.workspaceState.update('cortex.activeConversationId', this.activeConversationId);
      // Action snapshots can be large — only persist metadata
      const actionMeta = this.actionStack.map((a) => ({
        ...a,
        snapshot: Object.fromEntries(a.snapshot),
      }));
      this.context.workspaceState.update('cortex.actions', actionMeta);
    } catch (err) {
      console.error('[StateManager] Failed to persist state:', err);
    }
  }

  private restoreState(): void {
    try {
      // Restore conversations (new format)
      const convs = this.context.workspaceState.get<Conversation[]>('cortex.conversations');
      if (convs && convs.length > 0) {
        this.conversations = convs;
        const savedActiveId = this.context.workspaceState.get<string>('cortex.activeConversationId');
        const activeExists = savedActiveId && this.conversations.some((c) => c.id === savedActiveId);
        this.activeConversationId = activeExists
          ? savedActiveId!
          : this.conversations[0].id;
      } else {
        // Migrate from old format (cortex.messages → first conversation)
        const msgs = this.context.workspaceState.get<Message[]>('cortex.messages');
        const firstConv = this.createConversation('Chat 1');
        if (msgs && msgs.length > 0) {
          firstConv.messages = msgs;
          firstConv.updatedAt = msgs[msgs.length - 1].timestamp || Date.now();
          this.updateConversationTitle();
        }
      }

      const actions = this.context.workspaceState.get<any[]>('cortex.actions');
      if (actions) {
        this.actionStack = actions.map((a) => ({
          ...a,
          snapshot: new Map(Object.entries(a.snapshot || {})),
        }));
      }

      vscode.commands.executeCommand(
        'setContext', 'cortex.hasUndoableActions', this.actionStack.length > 0
      );
    } catch (err) {
      console.error('[StateManager] Failed to restore state:', err);
    }
  }

  dispose(): void {
    this.persistState();
    for (const d of this.disposables) d.dispose();
  }
}

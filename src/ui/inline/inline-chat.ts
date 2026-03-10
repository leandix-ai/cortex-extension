// ============================================================================
// Inline Chat — Native CodeLens + InputBox
// No Webview overhead. Uses VS Code's native APIs for zero-latency feel.
// ============================================================================

import * as vscode from 'vscode';
import { EventBus } from '../../core/event-bus';
import { StateManager } from '../../core/state-manager';

export class InlineChatHandler {
  private eventBus: EventBus;
  private stateManager: StateManager;

  constructor(eventBus: EventBus, stateManager: StateManager) {
    this.eventBus = eventBus;
    this.stateManager = stateManager;
  }

  async activate(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active editor for inline chat.');
      return;
    }

    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);
    const filePath = editor.document.uri.fsPath;

    // Show input box
    const prompt = await vscode.window.showInputBox({
      prompt: 'Ask Cortex about this code',
      placeHolder: selectedText
        ? `What would you like to do with the selected code? (${selectedText.split('\n').length} lines)`
        : 'Ask a question or request a change...',
      value: '',
    });

    if (!prompt) return;

    // Build contextual prompt
    let fullPrompt = prompt;
    if (selectedText) {
      fullPrompt = `${prompt}\n\nSelected code (${filePath}, lines ${selection.start.line + 1}-${selection.end.line + 1}):\n\`\`\`\n${selectedText}\n\`\`\``;
    }

    // Emit prompt event — Orchestrator handles the rest
    this.eventBus.emit('USER_PROMPT', {
      prompt: fullPrompt,
      selection: selectedText || undefined,
      filePath,
      lineRange: selectedText
        ? { start: selection.start.line, end: selection.end.line }
        : undefined,
    });

    // Focus sidebar to show response
    vscode.commands.executeCommand('cortex.chatView.focus');
  }
}

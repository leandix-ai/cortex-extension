// ============================================================================
// Editor Manipulator — Inline Diff, Ghost Typing, Accept/Reject
// Applies AI-generated changes directly into active editor.
// CodeLens buttons for Accept/Reject without modal dialogs.
// ============================================================================

import * as vscode from 'vscode';
import { AIAction } from '../core/types';
import { StateManager } from '../core/state-manager';

interface PendingChange {
  id: string;
  uri: vscode.Uri;
  range: vscode.Range;
  newText: string;
  decoration: vscode.TextEditorDecorationType;
}

export class EditorManipulator implements vscode.CodeLensProvider {
  private pendingChanges: Map<string, PendingChange> = new Map();
  private stateManager: StateManager;
  private disposables: vscode.Disposable[] = [];
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  // Decorations for ghost text
  private ghostDecoration = vscode.window.createTextEditorDecorationType({
    after: {},
    backgroundColor: 'rgba(100, 200, 100, 0.1)',
    isWholeLine: false,
  });

  private deletionDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(200, 100, 100, 0.15)',
    textDecoration: 'line-through',
  });

  constructor(stateManager: StateManager) {
    this.stateManager = stateManager;
  }

  // --- CodeLens Provider ---

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];

    for (const [id, change] of this.pendingChanges) {
      if (change.uri.toString() !== document.uri.toString()) continue;

      const range = new vscode.Range(change.range.start, change.range.start);

      lenses.push(
        new vscode.CodeLens(range, {
          title: '✓ Accept',
          command: 'cortex.acceptChange',
          arguments: [id],
        }),
        new vscode.CodeLens(range, {
          title: '✗ Reject',
          command: 'cortex.rejectChange',
          arguments: [id],
        })
      );
    }

    return lenses;
  }

  // --- Apply Changes ---

  /**
   * Show a proposed change as ghost text with Accept/Reject CodeLens.
   */
  async proposeChange(
    editor: vscode.TextEditor,
    range: vscode.Range,
    newText: string,
    messageId: string
  ): Promise<void> {
    const id = `change_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // Snapshot current content for undo
    const document = editor.document;
    const currentText = document.getText(range);
    const action: AIAction = {
      id: `action_${id}`,
      timestamp: Date.now(),
      type: 'replace',
      files: [document.uri.fsPath],
      snapshot: new Map([[document.uri.fsPath, document.getText()]]),
      messageId,
    };

    // Create decoration to highlight the change area
    const decoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(100, 200, 100, 0.12)',
      border: '1px dashed rgba(100, 200, 100, 0.5)',
      after: {
        contentText: ' ← AI change pending',
        color: 'rgba(100, 200, 100, 0.6)',
        fontStyle: 'italic',
      },
    });

    editor.setDecorations(decoration, [range]);

    this.pendingChanges.set(id, {
      id,
      uri: document.uri,
      range,
      newText,
      decoration,
    });

    // Store action for undo
    this.stateManager.pushAction(action);
    this._onDidChangeCodeLenses.fire();
  }

  /**
   * Apply change directly (for streaming / auto-apply mode).
   */
  async applyDirect(
    editor: vscode.TextEditor,
    range: vscode.Range,
    newText: string,
    messageId: string
  ): Promise<boolean> {
    const document = editor.document;

    // Snapshot
    const action: AIAction = {
      id: `action_${Date.now()}`,
      timestamp: Date.now(),
      type: 'replace',
      files: [document.uri.fsPath],
      snapshot: new Map([[document.uri.fsPath, document.getText()]]),
      messageId,
    };
    this.stateManager.pushAction(action);

    // Apply edit
    const success = await editor.edit((editBuilder: any) => {
      editBuilder.replace(range, newText);
    });

    return success;
  }

  /**
   * Stream tokens into the editor with "ghost typing" effect.
   */
  async streamToEditor(
    editor: vscode.TextEditor,
    startPosition: vscode.Position,
    token: string
  ): Promise<vscode.Position> {
    await editor.edit((editBuilder: any) => {
      editBuilder.insert(startPosition, token);
    });

    // Return new cursor position
    const lines = token.split('\n');
    if (lines.length > 1) {
      return new vscode.Position(
        startPosition.line + lines.length - 1,
        lines[lines.length - 1].length
      );
    } else {
      return new vscode.Position(
        startPosition.line,
        startPosition.character + token.length
      );
    }
  }

  // --- Accept / Reject ---

  async acceptChange(changeId: string): Promise<void> {
    const change = this.pendingChanges.get(changeId);
    if (!change) return;

    // Apply the change
    const doc = await vscode.workspace.openTextDocument(change.uri);
    const editor = await vscode.window.showTextDocument(doc);

    await editor.edit((editBuilder: any) => {
      editBuilder.replace(change.range, change.newText);
    });

    // Clean up
    change.decoration.dispose();
    this.pendingChanges.delete(changeId);
    this._onDidChangeCodeLenses.fire();

    vscode.window.showInformationMessage('Cortex: Change accepted');
  }

  async rejectChange(changeId: string): Promise<void> {
    const change = this.pendingChanges.get(changeId);
    if (!change) return;

    // Remove decoration, don't apply change
    change.decoration.dispose();
    this.pendingChanges.delete(changeId);
    this._onDidChangeCodeLenses.fire();

    // Pop the action from undo stack since we rejected
    // (This is simplified — in production, match by action ID)
    this.stateManager.popAction();

    vscode.window.showInformationMessage('Cortex: Change rejected');
  }

  // --- Undo Session ---

  async undoLastSession(): Promise<boolean> {
    const action = this.stateManager.popAction();
    if (!action) {
      vscode.window.showWarningMessage('No AI actions to undo.');
      return false;
    }

    // Restore all files from snapshot
    for (const [filePath, content] of action.snapshot) {
      try {
        const uri = vscode.Uri.file(filePath);

        if (action.type === 'file_create' && content === '') {
          // Delete file that was created
          await vscode.workspace.fs.delete(uri);
        } else {
          // Restore previous content
          const encoder = new TextEncoder();
          await vscode.workspace.fs.writeFile(uri, encoder.encode(content));
        }
      } catch (err) {
        console.error(`[EditorManipulator] Failed to restore ${filePath}:`, err);
      }
    }

    vscode.window.showInformationMessage(
      `Cortex: Undid AI action on ${action.files.length} file(s)`
    );
    return true;
  }

  dispose(): void {
    for (const change of this.pendingChanges.values()) {
      change.decoration.dispose();
    }
    this.pendingChanges.clear();
    this.ghostDecoration.dispose();
    this.deletionDecoration.dispose();
    this._onDidChangeCodeLenses.fire();
    for (const d of this.disposables) d.dispose();
  }
}

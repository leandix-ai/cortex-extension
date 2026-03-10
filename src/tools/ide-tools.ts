// ============================================================================
// IDE Tools — File Operations, Terminal, Search
// Direct interface to VS Code / Antigravity APIs.
// All calls are async and subject to Failure Budget timeouts.
// ============================================================================

import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { ToolDefinition, ToolResult, AIAction } from '../core/types';
import { StateManager } from '../core/state-manager';

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file. Returns the full file text.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative or absolute file path' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file. Creates the file if it does not exist. Overwrites if it does.',
    requiresConfirmation: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to write to' },
        content: { type: 'string', description: 'Full file content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Replace a specific string in a file. The old_string must match exactly and appear once.',
    requiresConfirmation: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        old_string: { type: 'string', description: 'Exact string to find (must be unique)' },
        new_string: { type: 'string', description: 'Replacement string' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'list_dir',
    description: 'List files and directories in a path. Returns names with [dir] or [file] prefix.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to list' },
        recursive: { type: 'boolean', description: 'List recursively (max 2 levels)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_files',
    description: 'Search for a text pattern across files in the workspace. Returns matching lines with file paths.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Text or regex pattern to search' },
        include: { type: 'string', description: 'Glob pattern for files to include (e.g., "**/*.ts")' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'run_terminal',
    description: 'Execute a command in the terminal. Requires user confirmation.',
    requiresConfirmation: true,
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
      },
      required: ['command'],
    },
  },
];

export class ToolExecutor {
  private stateManager: StateManager;
  private workspaceRoot: string;

  constructor(stateManager: StateManager) {
    this.stateManager = stateManager;
    this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    messageId: string,
    providedToolCallId?: string
  ): Promise<ToolResult> {
    const toolCallId = providedToolCallId || `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    try {
      switch (toolName) {
        case 'read_file':
          return await this.readFile(args.path as string, toolCallId);

        case 'write_file':
          // TODO: Tạm thời disable block trên UI. Cần hoàn thiện luồng xử lý sau.
          return await this.writeFile(
            args.path as string,
            args.content as string,
            toolCallId,
            messageId
          );

        case 'edit_file':
          // TODO: Tạm thời disable block trên UI. Cần hoàn thiện luồng xử lý sau.
          return await this.editFile(
            args.path as string,
            args.old_string as string,
            args.new_string as string,
            toolCallId,
            messageId
          );

        case 'list_dir':
          return await this.listDir(
            args.path as string,
            args.recursive as boolean,
            toolCallId
          );

        case 'search_files':
          return await this.searchFiles(
            args.pattern as string,
            args.include as string,
            toolCallId
          );

        case 'run_terminal':
          return await this.runTerminal(args.command as string, toolCallId);

        default:
          return { toolCallId, content: `Unknown tool: ${toolName}`, isError: true };
      }
    } catch (err: any) {
      return {
        toolCallId,
        content: `Tool error: ${err.message || String(err)}`,
        isError: true,
      };
    }
  }

  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) return filePath;
    return path.join(this.workspaceRoot, filePath);
  }

  private async readFile(filePath: string, toolCallId: string): Promise<ToolResult> {
    const resolved = this.resolvePath(filePath);
    const uri = vscode.Uri.file(resolved);
    const content = await vscode.workspace.fs.readFile(uri);
    return {
      toolCallId,
      content: Buffer.from(content).toString('utf-8'),
    };
  }

  private async writeFile(
    filePath: string,
    content: string,
    toolCallId: string,
    messageId: string
  ): Promise<ToolResult> {
    const resolved = this.resolvePath(filePath);
    const uri = vscode.Uri.file(resolved);

    // Snapshot before write
    let previousContent = '';
    let isNew = false;
    try {
      const existing = await vscode.workspace.fs.readFile(uri);
      previousContent = Buffer.from(existing).toString('utf-8');
    } catch {
      isNew = true;
    }

    // Record action for undo
    const action: AIAction = {
      id: `action_${Date.now()}`,
      timestamp: Date.now(),
      type: isNew ? 'file_create' : 'replace',
      files: [resolved],
      snapshot: new Map([[resolved, previousContent]]),
      messageId,
    };
    this.stateManager.pushAction(action);

    // Write file
    const encoder = new TextEncoder();
    await vscode.workspace.fs.writeFile(uri, encoder.encode(content));

    // Open file in editor
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });

    return {
      toolCallId,
      content: `File ${isNew ? 'created' : 'written'}: ${filePath} (${content.length} chars)`,
    };
  }

  private async editFile(
    filePath: string,
    oldString: string,
    newString: string,
    toolCallId: string,
    messageId: string
  ): Promise<ToolResult> {
    const resolved = this.resolvePath(filePath);
    const uri = vscode.Uri.file(resolved);

    const existing = await vscode.workspace.fs.readFile(uri);
    const content = Buffer.from(existing).toString('utf-8');

    // Verify old_string exists and is unique
    const firstIndex = content.indexOf(oldString);
    if (firstIndex === -1) {
      return { toolCallId, content: `String not found in ${filePath}`, isError: true };
    }
    const secondIndex = content.indexOf(oldString, firstIndex + 1);
    if (secondIndex !== -1) {
      return { toolCallId, content: `String appears multiple times in ${filePath}. Make it more specific.`, isError: true };
    }

    // Snapshot
    const action: AIAction = {
      id: `action_${Date.now()}`,
      timestamp: Date.now(),
      type: 'replace',
      files: [resolved],
      snapshot: new Map([[resolved, content]]),
      messageId,
    };
    this.stateManager.pushAction(action);

    // Apply edit
    const newContent = content.replace(oldString, newString);
    const encoder = new TextEncoder();
    await vscode.workspace.fs.writeFile(uri, encoder.encode(newContent));

    return {
      toolCallId,
      content: `Edited ${filePath}: replaced ${oldString.length} chars with ${newString.length} chars`,
    };
  }

  private async listDir(
    dirPath: string,
    recursive: boolean,
    toolCallId: string
  ): Promise<ToolResult> {
    const resolved = this.resolvePath(dirPath);
    const uri = vscode.Uri.file(resolved);

    const entries = await vscode.workspace.fs.readDirectory(uri);
    const lines: string[] = [];

    for (const [name, type] of entries) {
      if (name.startsWith('.') || name === 'node_modules') continue;
      const prefix = type === vscode.FileType.Directory ? '[dir]' : '[file]';
      lines.push(`${prefix} ${name}`);

      if (recursive && type === vscode.FileType.Directory) {
        try {
          const subUri = vscode.Uri.file(path.join(resolved, name));
          const subEntries = await vscode.workspace.fs.readDirectory(subUri);
          for (const [subName, subType] of subEntries) {
            if (subName.startsWith('.')) continue;
            const subPrefix = subType === vscode.FileType.Directory ? '[dir]' : '[file]';
            lines.push(`  ${subPrefix} ${name}/${subName}`);
          }
        } catch { /* skip unreadable dirs */ }
      }
    }

    return { toolCallId, content: lines.join('\n') || '(empty directory)' };
  }

  private async searchFiles(
    pattern: string,
    include: string,
    toolCallId: string
  ): Promise<ToolResult> {
    const files = await vscode.workspace.findFiles(
      include || '**/*',
      '**/node_modules/**',
      50 // max files
    );

    const results: string[] = [];
    const regex = new RegExp(pattern, 'gi');

    for (const uri of files) {
      try {
        const content = await vscode.workspace.fs.readFile(uri);
        const text = Buffer.from(content).toString('utf-8');
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            const relativePath = vscode.workspace.asRelativePath(uri);
            results.push(`${relativePath}:${i + 1}: ${lines[i].trim()}`);
            if (results.length >= 50) break;
          }
          regex.lastIndex = 0;
        }
      } catch { /* skip unreadable files */ }

      if (results.length >= 50) break;
    }

    return {
      toolCallId,
      content: results.length > 0
        ? results.join('\n')
        : `No matches found for "${pattern}"`,
    };
  }

  private async runTerminal(command: string, toolCallId: string): Promise<ToolResult> {
    const MAX_OUTPUT = 10_000; // 10KB cap to avoid flooding the context window
    const TIMEOUT_MS = 30_000; // 30s default timeout

    return new Promise((resolve) => {
      const child = exec(command, {
        cwd: this.workspaceRoot,
        timeout: TIMEOUT_MS,
        maxBuffer: 1024 * 1024, // 1MB buffer
        env: { ...process.env },
      }, (error, stdout, stderr) => {
        let output = '';

        if (stdout) {
          output += stdout;
        }
        if (stderr) {
          output += (output ? '\n--- stderr ---\n' : '') + stderr;
        }

        // Truncate if too long
        if (output.length > MAX_OUTPUT) {
          output = output.slice(0, MAX_OUTPUT) + `\n... (truncated, ${output.length} total chars)`;
        }

        if (error) {
          // Timeout or non-zero exit code
          const exitInfo = error.killed
            ? `Command timed out after ${TIMEOUT_MS / 1000}s`
            : `Exit code: ${error.code ?? 'unknown'}`;

          resolve({
            toolCallId,
            content: output
              ? `${exitInfo}\n\n${output}`
              : `${exitInfo}: ${command}`,
            isError: true,
          });
        } else {
          resolve({
            toolCallId,
            content: output || `Command completed successfully: ${command}`,
          });
        }
      });
    });
  }
}

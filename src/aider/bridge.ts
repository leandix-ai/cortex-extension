// ============================================================================
// Aider Bridge — Build command, spawn process, parse results
// Non-interactive mode: aider --message "..." --yes --no-auto-commits
// ============================================================================

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

// --- Interfaces ---

export interface AiderConfig {
    enabled: boolean;
    path: string;
    model: string;
    timeout: number; // seconds
}

export interface AiderRequest {
    message: string;
    files: string[];
    model: string;
    workspaceRoot: string;
    envVars: Record<string, string>; // env var name → value
    aiderPath: string;
    timeout: number;
}

export interface AiderResult {
    success: boolean;
    output: string;
    editedFiles: string[];
    error?: string;
}

// --- Default config ---

export const DEFAULT_AIDER_CONFIG: AiderConfig = {
    enabled: true,
    path: 'aider',
    model: 'claude-sonnet-4-20250514',
    timeout: 120,
};

// --- Command Builder ---

export function buildAiderCommand(req: AiderRequest): string[] {
    const args = [
        '--message',
        '-',                  // read message from stdin
        '--yes',              // auto-accept all edits
        '--no-auto-commits',  // Cortex manages git, not Aider
        '--no-pretty',        // plain text output for parsing
        '--no-git',           // skip git repo — Cortex manages project directly
        '--model', req.model,
    ];

    // Prevent Aider from reading project's .env (may conflict with injected env vars)
    const nullEnv = process.platform === 'win32' ? 'NUL' : '/dev/null';
    args.push('--env-file', nullEnv);

    // Add specific files
    for (const file of req.files) {
        args.push('--file', file);
    }

    return args;
}

// --- Output Parser ---

export function parseEditedFiles(output: string): string[] {
    // Aider --no-pretty format: "Wrote <path>" for each edited file
    const pattern = /^Wrote\s+(.+)$/gm;
    const files: string[] = [];
    let match;
    while ((match = pattern.exec(output)) !== null) {
        files.push(match[1].trim());
    }
    return files;
}

// --- File Context Resolver ---

export function resolveFilesForEdit(): string[] {
    const files: string[] = [];

    // 1. Active editor file
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        files.push(activeEditor.document.uri.fsPath);
    }

    // 2. Other open editors (limit 5)
    const openPaths = vscode.window.visibleTextEditors
        .map(e => e.document.uri.fsPath)
        .filter(p => !files.includes(p))
        .slice(0, 5);
    files.push(...openPaths);

    return [...new Set(files)]; // dedupe
}

// --- Terminal Executor ---

export async function executeAiderInTerminal(
    req: AiderRequest
): Promise<void> {
    // 1. Write the message to a temporary file
    const messageFile = path.join(req.workspaceRoot, '.aider.message.txt');
    await fs.writeFile(messageFile, req.message, 'utf-8');

    // 2. Build command arguments
    const args = [
        `--message-file "${messageFile}"`,
        '--yes',
        '--no-auto-commits',
        '--no-pretty',
        '--no-git',
        `--model ${req.model}`,
    ];

    const nullEnv = process.platform === 'win32' ? 'NUL' : '/dev/null';
    args.push(`--env-file ${nullEnv}`);

    for (const file of req.files) {
        args.push(`--file "${file}"`);
    }

    const command = `${req.aiderPath} ${args.join(' ')}`;

    // 3. Find and dispose existing Aider terminal
    const existingTerminal = vscode.window.terminals.find(t => t.name === 'Aider');
    if (existingTerminal) {
        existingTerminal.dispose();
    }

    // 4. Create new terminal with injected EnvVars (API Keys)
    const terminal = vscode.window.createTerminal({
        name: 'Aider',
        cwd: req.workspaceRoot,
        env: {
            ...process.env,
            ...req.envVars,
        }
    });

    terminal.show();

    // 5. Send command and execute
    terminal.sendText(command, true);
}

// --- Executor ---

export async function executeAider(
    req: AiderRequest,
    onToken?: (chunk: string) => void,
): Promise<AiderResult> {
    const args = buildAiderCommand(req);

    // Debug: log the full command for troubleshooting
    const redactedEnv = Object.keys(req.envVars).reduce((acc, k) => {
        acc[k] = k.includes('KEY') ? '***' : req.envVars[k];
        return acc;
    }, {} as Record<string, string>);
    console.log('[AiderBridge] Spawning:', req.aiderPath, args.join(' '));
    console.log('[AiderBridge] cwd:', req.workspaceRoot);
    console.log('[AiderBridge] env:', JSON.stringify(redactedEnv));

    return new Promise((resolve) => {
        const proc = spawn(req.aiderPath, args, {
            cwd: req.workspaceRoot,
            env: {
                ...process.env,
                ...req.envVars, // Inject dynamic env vars (keys, base URLs)
                'PYTHONIOENCODING': 'utf-8', // Fix Python output encoding
                'PYTHONUTF8': '1', // Ensure Python uses UTF-8 natively
            },
            // We avoid powershell.exe because it mangles Unicode command-line arguments.
            // Using shell: true (cmd.exe on Windows) provides a pseudo-console which prevents
            // Aider's prompt_toolkit from crashing ("No Windows console found").
            // With PYTHONIOENCODING=utf-8 and PYTHONUTF8=1, Unicode arguments actually survive
            // the cmd.exe execution perfectly inside Python.
            shell: process.platform === 'win32' ? true : true,
            timeout: req.timeout * 1000,
        });

        // Write the message to stdin so it isn't parsed by cmd.exe
        if (req.message) {
            proc.stdin.write(req.message + '\n');
        }
        proc.stdin.end();

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            const chunk = data.toString();
            stdout += chunk;
            onToken?.(chunk);
        });

        proc.stderr.on('data', (data) => {
            const chunk = data.toString();
            stderr += chunk;
            onToken?.(chunk); // Thêm dòng này để stream lỗi lên UI
        });

        proc.on('close', (code) => {
            const editedFiles = parseEditedFiles(stdout);

            // Aider thường ném các lỗi dạng này nhưng vẫn thoát code 0
            const hasAiderInternalError = stdout.includes('Exception:')
                || stdout.includes('Error:')
                || stderr.includes('Error:')
                || stdout.includes('litellm.exceptions.');

            const isSuccess = code === 0 && !hasAiderInternalError;

            let errorMessage: string | undefined = undefined;
            if (!isSuccess) {
                if (code !== 0) {
                    errorMessage = stderr || stdout || `Aider exited with code ${code}`;
                } else if (hasAiderInternalError) {
                    errorMessage = "Aider gặp lỗi nội bộ. Vui lòng xem log hiển thị ở trên.";
                }
            }

            resolve({
                success: isSuccess,
                output: stdout,
                editedFiles,
                error: errorMessage,
            });
        });

        proc.on('error', (err) => {
            resolve({
                success: false,
                output: '',
                editedFiles: [],
                error: `Failed to spawn aider: ${err.message}`,
            });
        });
    });
}

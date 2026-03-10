// ============================================================================
// Aider Guard — Lazy check if aider-cli is installed
// Only called when a complex+mutating request needs delegation.
// ============================================================================

import { exec as execCb } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCb);

/**
 * Check if Aider CLI is installed and accessible at the given path.
 * Runs `aider --version` and returns true if it exits successfully.
 */
export async function isAiderInstalled(aiderPath: string = 'aider'): Promise<boolean> {
    try {
        await exec(`"${aiderPath}" --version`, { shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh' });
        return true;
    } catch {
        return false;
    }
}

// ============================================================================
// LSP Context Graph Unit Tests
// Tests the offline global cache fallback logic when LSP fails/timeouts.
// ============================================================================

import * as assert from 'assert';
import * as vscode from 'vscode';
import { LSPContextGraph } from '../../context/lsp-graph';
import { LocalTokenCounter } from '../../intelligence/classifier';

suite('LSPContextGraph Caching and Fallback', () => {
    let graph: LSPContextGraph;
    let counter: LocalTokenCounter;

    setup(() => {
        counter = new LocalTokenCounter();
        graph = new LSPContextGraph(counter);
        graph.clearCache();
        // Clear static cache via reflection for testing
        (LSPContextGraph as any).globalFileCache.clear();
    });

    test('buildContext populates globalFileCache on LSP success', async () => {
        const uri1 = vscode.Uri.file('/path/to/file1.ts');
        const uri2 = vscode.Uri.file('/path/to/file2.ts');
        const doc = {
            uri: uri1,
            getText: () => 'content 1',
            languageId: 'typescript',
        } as unknown as vscode.TextDocument;

        // Mock executeCommand to return a definition
        const originalExecuteCommand = vscode.commands.executeCommand;
        try {
            (vscode.commands as any).executeCommand = async (command: string, ...args: any[]) => {
                if (command === 'vscode.executeDefinitionProvider') {
                    return [{
                        uri: uri2,
                        range: new vscode.Range(0, 0, 0, 10)
                    }];
                }
                return [];
            };

            // Needs to open doc
            const originalOpenTextDocument = vscode.workspace.openTextDocument;
            (vscode.workspace as any).openTextDocument = async (uri: vscode.Uri) => {
                return {
                    uri,
                    getText: () => 'mock content',
                    languageId: 'typescript'
                };
            };

            await graph.buildContext(doc, new vscode.Position(0, 0), 1000);

            const globalCache = (LSPContextGraph as any).globalFileCache as Map<string, Set<string>>;
            assert.ok(globalCache.has(uri1.toString()));
            assert.ok(globalCache.get(uri1.toString())!.has(uri2.toString()));

            (vscode.workspace as any).openTextDocument = originalOpenTextDocument;
        } finally {
            (vscode.commands as any).executeCommand = originalExecuteCommand;
        }
    });

    test('buildContext falls back to globalFileCache on LSP failure', async () => {
        const uri1 = vscode.Uri.file('/path/to/file1.ts');
        const uri2 = vscode.Uri.file('/path/to/fallback.ts');
        const doc = {
            uri: uri1,
            getText: () => 'content 1',
            languageId: 'typescript',
        } as unknown as vscode.TextDocument;

        // Pre-populate the global cache
        const globalCache = (LSPContextGraph as any).globalFileCache as Map<string, Set<string>>;
        globalCache.set(uri1.toString(), new Set([uri2.toString()]));

        // Mock executeCommand to fail (throw)
        const originalExecuteCommand = vscode.commands.executeCommand;
        try {
            (vscode.commands as any).executeCommand = async () => {
                throw new Error('LSP Error');
            };

            const originalOpenTextDocument = vscode.workspace.openTextDocument;
            (vscode.workspace as any).openTextDocument = async (uri: vscode.Uri) => {
                return {
                    uri,
                    getText: () => uri.fsPath === uri1.fsPath ? 'content 1' : 'fallback content',
                    languageId: 'typescript'
                };
            };

            // Call buildContext. It should catch the error and use the global cache.
            const result = await graph.buildContext(doc, new vscode.Position(0, 0), 1000);

            // Result should contain both start file and fallback file
            assert.strictEqual(result.length, 2);
            assert.ok(result.some(f => f.filePath === uri1.fsPath));
            assert.ok(result.some(f => f.filePath === uri2.fsPath));

            (vscode.workspace as any).openTextDocument = originalOpenTextDocument;
        } finally {
            (vscode.commands as any).executeCommand = originalExecuteCommand;
        }
    });
});

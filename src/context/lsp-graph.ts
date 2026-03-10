// ============================================================================
// LSP Context Graph — Symbol-Level Dependency Traversal
// Replaces flat file-list with a ranked dependency subgraph.
// Uses VS Code's built-in LSP data (definitions, references).
// ============================================================================

import * as vscode from 'vscode';
import { ContextFile } from '../core/types';
import { LocalTokenCounter } from '../intelligence/classifier';

interface GraphNode {
  uri: vscode.Uri;
  symbolName?: string;
  depth: number;
}

export class LSPContextGraph {
  private tokenCounter: LocalTokenCounter;
  private cache: Map<string, { files: ContextFile[]; timestamp: number }> = new Map();
  private cacheTTL = 10000; // 10 seconds

  // A global cache tracking file relationships (URI to URIs) across the entire session.
  // Acts as a fallback when LSP is unavailable or times out.
  private static globalFileCache: Map<string, Set<string>> = new Map();

  constructor(tokenCounter: LocalTokenCounter) {
    this.tokenCounter = tokenCounter;
  }

  /**
   * Build a context subgraph starting from the cursor position.
   * Walks definitions and references up to maxDepth, ranked by distance.
   */
  async buildContext(
    document: vscode.TextDocument,
    position: vscode.Position,
    maxTokens: number,
    timeoutMs: number = 300
  ): Promise<ContextFile[]> {
    const cacheKey = `${document.uri.toString()}:${position.line}:${position.character}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.files;
    }

    const visited = new Set<string>();
    const nodes: GraphNode[] = [];
    const startTime = Date.now();
    let madeLspCalls = false;
    let lspSuccess = false;

    // Start from current file
    const currentUri = document.uri;
    visited.add(currentUri.toString());
    nodes.push({ uri: currentUri, depth: 0 });

    // BFS traversal through definitions and references
    const queue: Array<{ uri: vscode.Uri; position: vscode.Position; depth: number }> = [
      { uri: currentUri, position, depth: 0 },
    ];

    while (queue.length > 0 && Date.now() - startTime < timeoutMs) {
      const current = queue.shift()!;
      if (current.depth >= 3) continue; // Max depth 3

      try {
        // Get definitions at current position
        const definitions = await Promise.race([
          vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeDefinitionProvider',
            current.uri,
            current.position
          ),
          new Promise<vscode.Location[]>((resolve) =>
            setTimeout(() => resolve([]), 100)
          ),
        ]);

        if (definitions) {
          madeLspCalls = true;
          lspSuccess = true;
          // Ensure base file is in cache
          if (!LSPContextGraph.globalFileCache.has(current.uri.toString())) {
            LSPContextGraph.globalFileCache.set(current.uri.toString(), new Set());
          }

          for (const def of definitions) {
            const key = def.uri.toString();
            if (!visited.has(key) && !this.isExternalFile(def.uri)) {
              visited.add(key);
              nodes.push({ uri: def.uri, depth: current.depth + 1 });
              queue.push({
                uri: def.uri,
                position: def.range.start,
                depth: current.depth + 1,
              });
              // Cache connection
              LSPContextGraph.globalFileCache.get(current.uri.toString())!.add(key);
            }
          }
        }

        // Get references (only at depth 0 to avoid explosion)
        if (current.depth === 0) {
          const references = await Promise.race([
            vscode.commands.executeCommand<vscode.Location[]>(
              'vscode.executeReferenceProvider',
              current.uri,
              current.position
            ),
            new Promise<vscode.Location[]>((resolve) =>
              setTimeout(() => resolve([]), 100)
            ),
          ]);

          if (references) {
            madeLspCalls = true;
            lspSuccess = true;
            for (const ref of references.slice(0, 5)) {
              const key = ref.uri.toString();
              if (!visited.has(key) && !this.isExternalFile(ref.uri)) {
                visited.add(key);
                nodes.push({ uri: ref.uri, depth: current.depth + 1 });
                // Cache connection in reverse (reference depends on base)
                if (!LSPContextGraph.globalFileCache.has(key)) {
                  LSPContextGraph.globalFileCache.set(key, new Set());
                }
                LSPContextGraph.globalFileCache.get(key)!.add(current.uri.toString());
              }
            }
          }
        }
      } catch {
        // LSP might not be available — graceful degradation
        continue;
      }
    }

    // --- Fallback: Offline Cache Traversal ---
    // If we tried to make LSP calls but they all failed/timed out,
    // or if we couldn't get any neighbors, use our global cache.
    if ((madeLspCalls && !lspSuccess) || nodes.length === 1) {
      this.populateFromGlobalCache(nodes, visited, currentUri, timeoutMs - (Date.now() - startTime));
    }

    // Read files and rank by relevance (lower depth = higher relevance)
    const files: ContextFile[] = [];
    let totalTokens = 0;

    // Sort by depth (closest first)
    nodes.sort((a, b) => a.depth - b.depth);

    for (const node of nodes) {
      if (totalTokens >= maxTokens) break;

      try {
        const doc = await vscode.workspace.openTextDocument(node.uri);
        const content = doc.getText();
        const tokens = this.tokenCounter.estimate(content);

        if (totalTokens + tokens > maxTokens) {
          // Trim to fit budget
          const remainingTokens = maxTokens - totalTokens;
          const charLimit = Math.floor(remainingTokens * 3.2);
          const trimmedContent = content.slice(0, charLimit) + '\n// ... (trimmed)';

          files.push({
            filePath: node.uri.fsPath,
            content: trimmedContent,
            relevanceScore: 1 / (node.depth + 1),
            language: doc.languageId,
          });
          break;
        }

        files.push({
          filePath: node.uri.fsPath,
          content,
          relevanceScore: 1 / (node.depth + 1),
          language: doc.languageId,
        });
        totalTokens += tokens;
      } catch {
        continue;
      }
    }

    // Cache the result
    this.cache.set(cacheKey, { files, timestamp: Date.now() });

    return files;
  }

  /**
   * Traverse the globalFileCache to find dependencies offline.
   */
  private populateFromGlobalCache(
    nodes: GraphNode[],
    visited: Set<string>,
    startUri: vscode.Uri,
    remainingTimeMs: number
  ): void {
    if (remainingTimeMs <= 0) return;

    const queue: Array<{ uri: vscode.Uri; depth: number }> = [
      { uri: startUri, depth: 0 }
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= 3) continue;

      const key = current.uri.toString();
      const neighbors = LSPContextGraph.globalFileCache.get(key);

      if (neighbors) {
        for (const neighborKey of neighbors) {
          if (!visited.has(neighborKey)) {
            visited.add(neighborKey);
            try {
              const neighborUri = vscode.Uri.parse(neighborKey);
              if (!this.isExternalFile(neighborUri)) {
                nodes.push({ uri: neighborUri, depth: current.depth + 1 });
                queue.push({ uri: neighborUri, depth: current.depth + 1 });
              }
            } catch {
              continue;
            }
          }
        }
      }
    }
  }

  /**
   * Fallback: flat file content when LSP is unavailable.
   */
  async buildFlatContext(
    document: vscode.TextDocument,
    maxTokens: number
  ): Promise<ContextFile[]> {
    const content = document.getText();
    const tokens = this.tokenCounter.estimate(content);

    const files: ContextFile[] = [
      {
        filePath: document.uri.fsPath,
        content: tokens > maxTokens
          ? content.slice(0, Math.floor(maxTokens * 3.2)) + '\n// ... (trimmed)'
          : content,
        relevanceScore: 1.0,
        language: document.languageId,
      },
    ];

    return files;
  }

  private isExternalFile(uri: vscode.Uri): boolean {
    const path = uri.fsPath;
    return path.includes('node_modules') ||
      path.includes('.git') ||
      path.includes('dist/') ||
      path.includes('out/') ||
      path.endsWith('.d.ts');
  }

  clearCache(): void {
    this.cache.clear();
  }
}

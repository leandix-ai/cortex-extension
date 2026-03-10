import * as vscode from 'vscode';
import { EventBus } from '../../core/event-bus';
import { StateManager } from '../../core/state-manager';
import { SidebarMessage } from '../../core/types';

export function createMessageHandler(
  eventBus: EventBus,
  stateManager: StateManager,
  notifyConversationChanged: () => void,
  postMessage: (msg: any) => void
): (msg: any) => void {
  return async (msg: any) => {
    switch (msg.type) {
      case 'prompt':
        eventBus.emit('USER_PROMPT', {
          prompt: msg.text,
          selection: stateManager.getActiveSelection(),
          filePath: stateManager.getActiveFilePath(),
        });
        break;

      case 'newConversation':
        stateManager.createConversation();
        notifyConversationChanged();
        break;

      case 'loadConversation':
        stateManager.switchConversation(msg.id);
        notifyConversationChanged();
        break;

      case 'deleteConversation':
        stateManager.deleteConversation(msg.id);
        notifyConversationChanged();
        break;

      case 'searchFiles': {
        const query = (msg.query || '').trim();
        try {
          let files: vscode.Uri[] = [];

          if (query.length === 0) {
            // Show all files when no query (when user just types @)
            files = await vscode.workspace.findFiles('**/*', '**/{node_modules,.git,dist,out,build,coverage}/**', 100);
          } else {
            // Search with query - support both filename and path matching
            const globPattern = `**/*${query}*`;
            const excludePattern = '**/{node_modules,.git,dist,out,build,coverage}/**';
            files = await vscode.workspace.findFiles(globPattern, excludePattern, 50);
          }

          // Convert to relative paths
          let results = files.map(f => vscode.workspace.asRelativePath(f));

          // Remove duplicates and sort by relevance
          const uniqueResults = [...new Set(results)];

          if (query.length > 0) {
            // Sort by how well the query matches
            uniqueResults.sort((a, b) => {
              const aLower = a.toLowerCase();
              const bLower = b.toLowerCase();
              const queryLower = query.toLowerCase();

              // Exact filename match scores highest
              const aFileName = a.split(/[\\/]/).pop()?.toLowerCase() || '';
              const bFileName = b.split(/[\\/]/).pop()?.toLowerCase() || '';

              const aFileMatch = aFileName.includes(queryLower);
              const bFileMatch = bFileName.includes(queryLower);

              if (aFileMatch && !bFileMatch) return -1;
              if (!aFileMatch && bFileMatch) return 1;

              // Then by starts with
              const aStarts = aLower.startsWith(queryLower);
              const bStarts = bLower.startsWith(queryLower);

              if (aStarts && !bStarts) return -1;
              if (!aStarts && bStarts) return 1;

              // Then alphabetically
              return a.localeCompare(b);
            });
          } else {
            uniqueResults.sort();
          }

          // Send back results
          postMessage({
            type: 'searchResults',
            results: uniqueResults
          });
        } catch (e) {
          console.error('[Webview Handler] Error searching files:', e);
          postMessage({
            type: 'searchResults',
            results: []
          });
        }
        break;
      }

      case 'toolConfirmResponse':
        eventBus.emit('TOOL_CONFIRM_RESPONSE', {
          toolCallId: msg.toolCallId,
          approved: msg.approved,
        });
        break;
    }
  };
}

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { EventBus } from '../../core/event-bus';
import { StateManager } from '../../core/state-manager';
import { SidebarMessage } from '../../core/types';
import { createMessageHandler } from './webview-handlers';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'cortex.chatView';

  private view?: vscode.WebviewView;
  private eventBus: EventBus;
  private stateManager: StateManager;
  private getProfile: () => { name: string; model: string };
  private disposables: Array<vscode.Disposable | (() => void)> = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    eventBus: EventBus,
    stateManager: StateManager,
    getProfile: () => { name: string; model: string }
  ) {
    this.eventBus = eventBus;
    this.stateManager = stateManager;
    this.getProfile = getProfile;

    // Listen for events and forward to webview
    this.disposables.push(
      (() => this.eventBus.on('STREAM_CONTENT', (event: any) => {
        this.postMessage({ type: 'content', token: event.payload.token, messageId: event.payload.messageId });
      }))()
    );

    this.disposables.push(
      (() => this.eventBus.on('STREAM_THINKING', (event: any) => {
        this.postMessage({
          type: 'thinking',
          token: event.payload.token,
          messageId: event.payload.messageId,
          source: event.payload.source || 'fast'
        });
      }))()
    );

    this.disposables.push(
      (() => this.eventBus.on('STREAM_START', (event: any) => {
        this.postMessage({ type: 'streamStart', messageId: event.payload.messageId });
      }))()
    );

    this.disposables.push(
      (() => this.eventBus.on('STREAM_END', (event: any) => {
        this.postMessage({ type: 'streamEnd', messageId: event.payload.messageId });
      }))()
    );

    this.disposables.push(
      (() => this.eventBus.on('STREAM_ERROR', (event: any) => {
        this.postMessage({ type: 'error', message: event.payload.message });
      }))()
    );

    this.disposables.push(
      (() => this.eventBus.on('STREAM_CLASSIFICATION', (event: any) => {
        this.postMessage({
          type: 'classification',
          messageId: event.payload.messageId,
          classification: event.payload.classification
        });
      }))()
    );

    this.disposables.push(
      (() => this.eventBus.on('PROFILE_CHANGED', (event: any) => {
        this.postMessage({
          type: 'profileChanged',
          profile: event.payload.profile,
          model: event.payload.model,
        });
      }))()
    );

    this.disposables.push(
      (() => this.eventBus.on('TOOL_CONFIRM_REQUEST', (event: any) => {
        this.postMessage({
          type: 'toolConfirm',
          toolCallId: event.payload.toolCallId,
          tool: event.payload.tool,
          args: event.payload.args,
          messageId: event.payload.messageId,
        });
      }))()
    );
  }

  notifyConversationChanged(): void {
    this.postMessage({
      type: 'conversationList',
      conversations: this.stateManager.getConversationList(),
    });
    this.postMessage({
      type: 'history',
      messages: this.stateManager.getMessages(),
    });
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    const distPath = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [distPath],
    };

    webviewView.webview.html = this.getWebviewHtml(webviewView.webview, distPath);

    // Handle messages from webview
    const messageHandler = createMessageHandler(
      this.eventBus,
      this.stateManager,
      () => this.notifyConversationChanged(),
      (msg: any) => this.postMessage(msg)
    );
    webviewView.webview.onDidReceiveMessage(messageHandler);

    // Send initial conversation data
    this.notifyConversationChanged();

    // Send current profile from orchestrator
    const profile = this.getProfile();
    this.postMessage({
      type: 'profileChanged',
      profile: profile.name,
      model: profile.model,
    });
  }

  private postMessage(message: SidebarMessage | Record<string, any>): void {
    this.view?.webview.postMessage(message);
  }

  /**
   * Reads the Vite-compiled dist/webview/index.html and rewrites asset paths
   * to valid webview URIs. Falls back to a minimal page if build output is missing.
   */
  private getWebviewHtml(webview: vscode.Webview, distUri: vscode.Uri): string {
    const indexPath = path.join(distUri.fsPath, 'index.html');

    if (!fs.existsSync(indexPath)) {
      return `<!DOCTYPE html><html><body>
        <p style="padding:20px;color:var(--vscode-errorForeground)">
          Webview build not found. Run <code>npm run build:webview</code> first.
        </p>
      </body></html>`;
    }

    let html = fs.readFileSync(indexPath, 'utf-8');

    // Rewrite relative asset paths (src="./assets/..." or href="./assets/...")
    // to proper webview URIs
    html = html.replace(
      /(src|href)="\.?\/?assets\//g,
      (_, attr) => {
        const assetsUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'assets'));
        return `${attr}="${assetsUri}/`;
      }
    );

    // Inject CSP meta tag allowing the webview's own scripts/styles
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
    ].join('; ');

    html = html.replace(
      '<head>',
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}">`
    );

    return html;
  }

  dispose(): void {
    for (const d of this.disposables) {
      if (typeof d === 'function') d();
      else d.dispose();
    }
  }
}

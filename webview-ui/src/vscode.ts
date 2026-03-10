// ============================================================================
// VS Code Webview API wrapper
// Typed postMessage interface for extension ↔ webview communication.
// ============================================================================

interface VsCodeApi {
    postMessage(message: any): void;
    getState(): any;
    setState(state: any): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// Singleton — acquireVsCodeApi() can only be called once
const vscode = acquireVsCodeApi();

export function postMessage(msg: Record<string, any>): void {
    vscode.postMessage(msg);
}

export function sendPrompt(text: string): void {
    postMessage({ type: 'prompt', text });
}

export function newConversation(): void {
    postMessage({ type: 'newConversation' });
}

export function loadConversation(id: string): void {
    postMessage({ type: 'loadConversation', id });
}

export function deleteConversation(id: string): void {
    postMessage({ type: 'deleteConversation', id });
}

export function searchFiles(query: string): void {
    postMessage({ type: 'searchFiles', query });
}

export function toolConfirmResponse(toolCallId: string, approved: boolean): void {
    postMessage({ type: 'toolConfirmResponse', toolCallId, approved });
}

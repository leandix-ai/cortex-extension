// ============================================================================
// Chat Store — reactive state for messages, streaming, conversations
// ============================================================================

import { writable, derived, get } from 'svelte/store';

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    thinking?: string;
}

export interface ConversationItem {
    id: string;
    title: string;
    updatedAt: number;
    messageCount: number;
}

export interface Classification {
    complexity: string;
    needsTools: boolean;
}

export interface ToolConfirm {
    toolCallId: string;
    tool: string;
    args: Record<string, any>;
    status?: 'accepted' | 'denied';
}

// --- Stores ---

export const messages = writable<ChatMessage[]>([]);
export const isStreaming = writable(false);
export const currentStreamContent = writable('');
export const currentStreamThinking = writable('');
export const conversations = writable<ConversationItem[]>([]);
export const activeConversationId = writable<string | null>(null);
export const profileName = writable('loading...');
export const profileModel = writable('');


// Classification for the current response
export const currentClassification = writable<Classification | null>(null);

// Tool confirmations (active ones, keyed by toolCallId)
export const toolConfirmations = writable<ToolConfirm[]>([]);

// Error message
export const errorMessage = writable<string | null>(null);

// --- Actions ---

export function addUserMessage(content: string): void {
    messages.update((msgs) => [...msgs, { role: 'user', content }]);
}

export function startStreaming(): void {
    isStreaming.set(true);
    currentStreamContent.set('');
    currentStreamThinking.set('');
    currentClassification.set(null);
    errorMessage.set(null);
    toolConfirmations.set([]);
}

export function appendStreamContent(token: string): void {
    currentStreamContent.update((c) => c + token);
}

export function appendStreamThinking(token: string): void {
    currentStreamThinking.update((t) => t + token);
}

export function endStreaming(): void {
    const content = get(currentStreamContent);
    const thinking = get(currentStreamThinking);

    if (content) {
        messages.update((msgs) => [
            ...msgs,
            { role: 'assistant', content, thinking: thinking || undefined },
        ]);
    }

    isStreaming.set(false);
    currentStreamContent.set('');
    currentStreamThinking.set('');
}

export function setHistory(msgs: ChatMessage[]): void {
    messages.set(msgs);
    endStreaming();
}

export function setConversationList(convs: ConversationItem[]): void {
    conversations.set(convs);
}

export function setProfile(name: string, model: string): void {
    profileName.set(name);
    profileModel.set(model);
}

export function setClassification(cls: Classification): void {
    currentClassification.set(cls);
}

export function addToolConfirmation(confirm: ToolConfirm): void {
    toolConfirmations.update((list) => [...list, confirm]);
}

export function resolveToolConfirmation(toolCallId: string, approved: boolean): void {
    toolConfirmations.update((list) =>
        list.map((tc) =>
            tc.toolCallId === toolCallId
                ? { ...tc, status: approved ? 'accepted' : 'denied' }
                : tc
        )
    );
}

export function setError(message: string): void {
    errorMessage.set(message);
    isStreaming.set(false);
}

// ============================================================================
// UI Store — reactive state for UI-only concerns
// ============================================================================

import { writable } from 'svelte/store';

export const historyPanelOpen = writable(false);
export const mentionActive = writable(false);
export const mentionQuery = writable('');
export const mentionResults = writable<string[]>([]);
export const mentionSelectedIndex = writable(0);

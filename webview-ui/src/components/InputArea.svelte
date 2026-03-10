<script lang="ts">
  import { onMount } from 'svelte';
  import MentionMenu from './MentionMenu.svelte';
  import { isStreaming, addUserMessage } from '../stores/chat';
  import { historyPanelOpen, mentionActive, mentionQuery, mentionResults, mentionSelectedIndex } from '../stores/ui';
  import { sendPrompt, searchFiles } from '../vscode';
  import { get } from 'svelte/store';

  let inputEl: HTMLTextAreaElement;
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    inputEl?.focus();
  });

  function handleSend() {
    const text = inputEl.value.trim();
    if (!text || get(isStreaming)) return;

    addUserMessage(text);
    sendPrompt(text);
    inputEl.value = '';
    inputEl.style.height = '36px';
  }

  function closeMentionMenu() {
    mentionActive.set(false);
    mentionResults.set([]);
    mentionSelectedIndex.set(0);
    mentionQuery.set('');
  }

  function insertMention(path: string) {
    if (!get(mentionActive) || !path) return;

    const val = inputEl.value;
    const cursor = inputEl.selectionStart;
    const textBeforeCursor = val.slice(0, cursor);
    const textAfterCursor = val.slice(cursor);

    const match = textBeforeCursor.match(/(?:^|\s)@([^\s]*)$/);
    if (match) {
      const replaceStart = cursor - match[0].length + (match[0].startsWith(' ') ? 1 : 0);
      const newVal = val.slice(0, replaceStart) + '@' + path + ' ' + textAfterCursor;
      inputEl.value = newVal;
      const newCursor = replaceStart + path.length + 2;
      inputEl.setSelectionRange(newCursor, newCursor);
      inputEl.focus();
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.max(36, Math.min(inputEl.scrollHeight, 120)) + 'px';
    }
    closeMentionMenu();
  }

  function handleKeydown(e: KeyboardEvent) {
    const menuVisible = get(mentionActive);

    if (menuVisible) {
      const results = get(mentionResults);
      let selIdx = get(mentionSelectedIndex);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (results.length > 0) {
          mentionSelectedIndex.set((selIdx + 1) % results.length);
        }
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (results.length > 0) {
          mentionSelectedIndex.set((selIdx - 1 + results.length) % results.length);
        }
        return;
      } else if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
        e.preventDefault();
        if (results.length > 0 && results[selIdx]) {
          insertMention(results[selIdx]);
        }
        return;
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeMentionMenu();
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && !menuVisible) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleInput() {
    // Auto-resize
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.max(36, Math.min(inputEl.scrollHeight, 120)) + 'px';

    // Mention detection
    const val = inputEl.value;
    const cursor = inputEl.selectionStart;
    const textBeforeCursor = val.slice(0, cursor);
    const match = textBeforeCursor.match(/(?:^|\s)@([^\s]*)$/);

    if (match) {
      const query = match[1];

      if (!get(mentionActive)) {
        mentionActive.set(true);
        mentionQuery.set(query);
        mentionSelectedIndex.set(0);
        mentionResults.set([]);
        searchFiles(query);
      }

      if (get(mentionQuery) !== query) {
        mentionQuery.set(query);
        mentionSelectedIndex.set(0);
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
          searchFiles(query);
        }, 150);
      }
    } else {
      if (get(mentionActive)) {
        closeMentionMenu();
        if (searchDebounceTimer) {
          clearTimeout(searchDebounceTimer);
          searchDebounceTimer = null;
        }
      }
    }
  }

  function handleFocus() {
    if (get(historyPanelOpen)) {
      historyPanelOpen.set(false);
    }
  }
</script>

<div class="input-area">
  <div class="input-wrapper">
    <MentionMenu onSelect={insertMention} />
    <textarea
      bind:this={inputEl}
      placeholder="Ask Cortex... (Enter to send, Shift+Enter for newline)"
      rows="2"
      on:keydown={handleKeydown}
      on:input={handleInput}
      on:focus={handleFocus}
    ></textarea>
    <button class="send-btn" on:click={handleSend} disabled={$isStreaming}>Send</button>
  </div>
</div>

<style>
  .input-area {
    padding: 8px 12px;
    border-top: 1px solid var(--vscode-panel-border);
    flex-shrink: 0;
    background: var(--vscode-sideBar-background);
    z-index: 10;
    position: relative;
  }
  .input-wrapper {
    display: flex;
    flex-direction: column;
    gap: 6px;
    position: relative;
  }
  textarea {
    width: 100%;
    border: 1px solid var(--vscode-input-border);
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    font-family: inherit;
    font-size: inherit;
    padding: 8px 10px;
    border-radius: 4px;
    resize: none;
    min-height: 60px;
    max-height: 150px;
    outline: none;
    box-sizing: border-box;
  }
  textarea:focus {
    border-color: var(--vscode-focusBorder);
  }
  .send-btn {
    width: 100%;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 8px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
  }
  .send-btn:hover {
    background: var(--vscode-button-hoverBackground);
  }
  .send-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>

<script lang="ts">
  import { conversations, activeConversationId } from '../stores/chat';
  import { historyPanelOpen } from '../stores/ui';
  import { loadConversation, deleteConversation } from '../vscode';

  function handleSelect(id: string) {
    activeConversationId.set(id);
    loadConversation(id);
    historyPanelOpen.set(false);
  }

  function handleDelete(e: Event, id: string) {
    e.stopPropagation();
    deleteConversation(id);
  }

  function formatDate(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
</script>

<div class="history-panel" class:open={$historyPanelOpen}>
  <div class="history-header">Recent Chats</div>
  <div class="history-list">
    {#if $conversations.length === 0}
      <div class="empty">No history</div>
    {:else}
      {#each $conversations as conv (conv.id)}
        <div
          class="history-item"
          class:active={conv.id === $activeConversationId}
          on:click={() => handleSelect(conv.id)}
          role="button"
          tabindex="0"
          on:keydown={(e) => e.key === 'Enter' && handleSelect(conv.id)}
        >
          <div class="history-item-info">
            <div class="history-item-title">{conv.title || 'New Chat'}</div>
            <div class="history-item-date">{formatDate(conv.updatedAt)}</div>
          </div>
          <button class="delete-btn" title="Delete Chat" on:click={(e) => handleDelete(e, conv.id)}>
            <svg viewBox="0 0 16 16"><path d="M4 4h8v10H4V4zm1-2h6v1H5V2zM2 3h12v1H2V3z"/></svg>
          </button>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .history-panel {
    position: absolute;
    top: 37px;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--vscode-sideBar-background);
    z-index: 5;
    transform: translateX(-100%);
    transition: transform 0.2s ease-in-out;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--vscode-panel-border);
  }
  .history-panel.open { transform: translateX(0); }
  .history-header {
    padding: 8px 12px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    opacity: 0.6;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .history-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .empty {
    opacity: 0.5;
    padding: 8px;
    font-size: 11px;
    text-align: center;
  }
  .history-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }
  .history-item:hover { background: var(--vscode-list-hoverBackground); }
  .history-item.active {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }
  .history-item-info {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .history-item-title {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
  }
  .history-item-date {
    font-size: 10px;
    opacity: 0.6;
  }
  .delete-btn {
    background: none;
    border: none;
    color: inherit;
    opacity: 0;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
  }
  .history-item:hover .delete-btn { opacity: 0.6; }
  .delete-btn:hover {
    opacity: 1 !important;
    background: var(--vscode-toolbar-hoverBackground);
  }
  .delete-btn svg {
    width: 12px;
    height: 12px;
    fill: currentColor;
  }
</style>

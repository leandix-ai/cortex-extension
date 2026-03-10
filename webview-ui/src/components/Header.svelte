<script lang="ts">
  import { profileName, profileModel } from '../stores/chat';
  import { historyPanelOpen } from '../stores/ui';
  import { newConversation } from '../vscode';

  function toggleHistory() {
    historyPanelOpen.update((v) => !v);
  }

  function handleNewChat() {
    newConversation();
    historyPanelOpen.set(false);
  }

  $: badgeText = $profileModel
    ? `${$profileName} (${$profileModel.split('/').pop()})`
    : $profileName;
</script>

<div class="header">
  <div class="header-left">
    <button class="icon-btn" title="Show History" on:click={toggleHistory}>
      <svg viewBox="0 0 16 16"><path d="M2.5 4h11v1h-11V4zm0 3.5h11v1h-11v-1zm0 3.5h11v1h-11v-1z"/></svg>
    </button>
    <span class="title">Cortex AI</span>
  </div>
  <div class="header-actions">
    <span class="profile-badge">{badgeText}</span>
    <button class="icon-btn" title="New Chat" on:click={handleNewChat}>
      <svg viewBox="0 0 16 16"><path d="M14 7v1H8v6H7V8H1V7h6V1h1v6h6z"/></svg>
    </button>
  </div>
</div>

<style>
  .header {
    padding: 8px 12px;
    border-bottom: 1px solid var(--vscode-panel-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    background: var(--vscode-sideBar-background);
    z-index: 10;
  }
  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .title {
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    opacity: 0.8;
  }
  .header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .icon-btn {
    background: none;
    border: none;
    color: var(--vscode-icon-foreground);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.8;
  }
  .icon-btn:hover {
    background: var(--vscode-toolbar-hoverBackground);
    opacity: 1;
  }
  .icon-btn svg {
    width: 14px;
    height: 14px;
    fill: currentColor;
  }
  .profile-badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>

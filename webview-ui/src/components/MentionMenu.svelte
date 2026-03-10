<script lang="ts">
  import { mentionActive, mentionResults, mentionSelectedIndex } from '../stores/ui';

  export let onSelect: (path: string) => void;

  function handleClick(path: string) {
    onSelect(path);
  }
</script>

{#if $mentionActive}
  <div class="mention-menu active">
    {#if $mentionResults.length === 0}
      <div class="mention-empty">Loading files...</div>
    {:else}
      {#each $mentionResults as result, idx (result)}
        <button
          type="button"
          class="mention-item"
          class:selected={idx === $mentionSelectedIndex}
          on:click={() => handleClick(result)}
          role="option"
          aria-selected={idx === $mentionSelectedIndex}
        >
          <div class="mention-icon">
            <svg viewBox="0 0 16 16"><path d="M13.85 4.44l-3.28-3.3-.35-.14H2.5l-.5.5v13l.5.5h11l.5-.5V4.8l-.15-.36zM10 2.2l2.8 2.8H10V2.2zM13 14H3V2h6v4h4v8z"/></svg>
          </div>
          <div class="mention-label">{result}</div>
        </button>
      {/each}
    {/if}
  </div>
{/if}

<style>
  .mention-menu {
    position: absolute;
    bottom: 100%;
    left: 0;
    right: 0;
    margin-bottom: 4px;
    max-height: 200px;
    overflow-y: auto;
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: 4px;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    z-index: 100;
    display: none;
    flex-direction: column;
  }
  .mention-menu.active { display: flex; }
  .mention-empty {
    padding: 12px;
    text-align: center;
    font-size: 11px;
    opacity: 0.5;
    font-style: italic;
  }
  .mention-item {
    width: 100%;
    background: none;
    border: none;
    text-align: left;
    padding: 6px 10px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--vscode-editorWidget-foreground);
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .mention-item:last-child { border-bottom: none; }
  .mention-item:hover, .mention-item.selected {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }
  .mention-icon {
    opacity: 0.8;
    display: flex;
  }
  .mention-icon svg {
    width: 14px;
    height: 14px;
    fill: currentColor;
  }
  .mention-label {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    direction: rtl;
    text-align: left;
  }
</style>

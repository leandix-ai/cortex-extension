<script lang="ts">
  import { toolConfirmResponse } from '../vscode';

  export let toolCallId: string;
  export let tool: string;
  export let args: Record<string, any>;
  export let status: 'accepted' | 'denied' | undefined = undefined;

  function respond(approved: boolean) {
    toolConfirmResponse(toolCallId, approved);
    status = approved ? 'accepted' : 'denied';
  }

  $: argsEntries = Object.entries(args);
  
  // TODO: Hỗ trợ sau cho các tool write_file, edit_file, delete_file
  $: isUnsupported = ['write_file', 'edit_file', 'delete_file', 'create_file'].includes(tool);
</script>

<div class="tool-confirm-card">
  <div class="tool-confirm-header">
    <svg viewBox="0 0 16 16"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm1 10H7v-1h2v1zm0-3H7V4h2v4z"/></svg>
    Confirm: <strong>{tool}</strong>
  </div>

  {#if argsEntries.length > 0}
    <div class="tool-confirm-args">
      {#each argsEntries as [key, val]}
        <div class="tool-confirm-arg">
          <span class="arg-key">{key}:</span>
          <span class="arg-val">{String(val || '').length > 200 ? String(val).slice(0, 200) + '...' : String(val || '')}</span>
        </div>
      {/each}
    </div>
  {/if}

  {#if status}
    <div class="tool-confirm-status" class:accepted={status === 'accepted'} class:denied={status === 'denied'}>
      {status === 'accepted' ? '✓ Accepted' : '✗ Denied'}
    </div>
  {:else if isUnsupported}
    <div class="tool-confirm-message" style="color: var(--vscode-editorWarning-foreground, #cca700); font-size: 11px; margin-bottom: 8px;">
      ⚠️ Tool này hiện đang được phát triển nên chưa được hỗ trợ.
    </div>
    <div class="tool-confirm-actions">
      <button class="tool-confirm-btn deny" on:click={() => respond(false)}>Dismiss</button>
    </div>
  {:else}
    <div class="tool-confirm-actions">
      <button class="tool-confirm-btn accept" on:click={() => respond(true)}>Accept</button>
      <button class="tool-confirm-btn deny" on:click={() => respond(false)}>Deny</button>
    </div>
  {/if}
</div>

<style>
  .tool-confirm-card {
    border: 1px solid var(--vscode-editorWarning-foreground, #cca700);
    border-radius: 6px;
    padding: 10px;
    margin: 6px 0;
    background: var(--vscode-editor-background);
  }
  .tool-confirm-header {
    font-size: 12px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--vscode-editorWarning-foreground, #cca700);
    margin-bottom: 8px;
  }
  .tool-confirm-header svg {
    width: 14px;
    height: 14px;
    fill: currentColor;
    flex-shrink: 0;
  }
  .tool-confirm-args {
    font-size: 11px;
    background: var(--vscode-textCodeBlock-background);
    border-radius: 4px;
    padding: 6px 8px;
    margin-bottom: 8px;
    max-height: 120px;
    overflow-y: auto;
  }
  .tool-confirm-arg {
    margin-bottom: 4px;
    word-break: break-all;
  }
  .tool-confirm-arg:last-child { margin-bottom: 0; }
  .arg-key {
    font-weight: 600;
    color: var(--vscode-symbolIcon-fieldForeground, #75beff);
  }
  .arg-val {
    font-family: var(--vscode-editor-font-family, monospace);
    opacity: 0.85;
    white-space: pre-wrap;
  }
  .tool-confirm-actions {
    display: flex;
    gap: 8px;
  }
  .tool-confirm-btn {
    flex: 1;
    padding: 5px 12px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
  }
  .tool-confirm-btn.accept {
    background: var(--vscode-testing-iconPassed, #388a34);
    color: #fff;
  }
  .tool-confirm-btn.accept:hover { opacity: 0.9; }
  .tool-confirm-btn.deny {
    background: var(--vscode-testing-iconFailed, #d32f2f);
    color: #fff;
  }
  .tool-confirm-btn.deny:hover { opacity: 0.9; }
  .tool-confirm-status {
    font-size: 11px;
    font-weight: 600;
    padding: 4px 0;
  }
  .tool-confirm-status.accepted { color: var(--vscode-testing-iconPassed, #388a34); }
  .tool-confirm-status.denied { color: var(--vscode-testing-iconFailed, #d32f2f); }
</style>

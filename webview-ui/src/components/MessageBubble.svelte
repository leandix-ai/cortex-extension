<script lang="ts">
  import { renderMarkdown } from '../lib/markdown';

  export let role: 'user' | 'assistant';
  export let content: string;
  export let thinking: string | undefined = undefined;

  let thinkingCollapsed = true;

  function toggleThinking() {
    thinkingCollapsed = !thinkingCollapsed;
  }

  $: renderedContent = renderMarkdown(content);
</script>

<div class="message">
  <div class="message-role">{role === 'user' ? 'You' : 'Cortex'}</div>

  {#if thinking}
    <div class="thinking-panel">
      <div class="thinking-toggle" on:click={toggleThinking} role="button" tabindex="0" on:keydown={(e) => e.key === 'Enter' && toggleThinking()}>
        {thinkingCollapsed ? '▸' : '▾'} Thinking
      </div>
      {#if !thinkingCollapsed}
        <div class="thinking-content">{thinking}</div>
      {/if}
    </div>
  {/if}

  <div class="message-content">{@html renderedContent}</div>
</div>

<style>
  .message {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .message-role {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    opacity: 0.6;
  }
  .message-content {
    line-height: 1.5;
    word-break: break-word;
  }
  .message-content :global(p) { margin-bottom: 8px; }
  .message-content :global(p:last-child) { margin-bottom: 0; }
  .message-content :global(ul), .message-content :global(ol) {
    margin-bottom: 8px;
    padding-left: 20px;
  }
  .message-content :global(li) { margin-bottom: 4px; }
  .message-content :global(h1), .message-content :global(h2), .message-content :global(h3),
  .message-content :global(h4), .message-content :global(h5), .message-content :global(h6) {
    margin: 12px 0 8px 0;
    font-weight: 600;
    line-height: 1.2;
  }
  .message-content :global(blockquote) {
    border-left: 3px solid var(--vscode-textBlockQuote-background, #808080);
    padding-left: 12px;
    margin: 8px 0;
    opacity: 0.8;
    font-style: italic;
  }
  .message-content :global(code) {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    background: var(--vscode-textCodeBlock-background);
    padding: 1px 4px;
    border-radius: 3px;
  }
  .message-content :global(pre) {
    background: var(--vscode-textCodeBlock-background);
    padding: 8px;
    border-radius: 4px;
    overflow-x: auto;
    margin: 4px 0;
  }
  .message-content :global(pre code) {
    background: none;
    padding: 0;
  }
  .thinking-panel {
    margin-top: 4px;
    border-left: 2px solid var(--vscode-textLink-foreground);
    padding-left: 8px;
  }
  .thinking-toggle {
    font-size: 11px;
    cursor: pointer;
    color: var(--vscode-textLink-foreground);
    user-select: none;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .thinking-content {
    font-size: 12px;
    opacity: 0.7;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 200px;
    overflow-y: auto;
    margin-top: 4px;
  }
</style>

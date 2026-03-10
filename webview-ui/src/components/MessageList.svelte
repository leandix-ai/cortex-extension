<script lang="ts">
  import { onMount, afterUpdate, tick } from 'svelte';
  import MessageBubble from './MessageBubble.svelte';
  import ToolConfirmCard from './ToolConfirmCard.svelte';
  import ClassificationBadge from './ClassificationBadge.svelte';
  import {
    messages, isStreaming, currentStreamContent, currentStreamThinking,
    currentClassification, toolConfirmations, errorMessage,
  } from '../stores/chat';
  import { renderMarkdown } from '../lib/markdown';

  let messagesContainer: HTMLDivElement;

  function scrollToBottom() {
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }

  afterUpdate(scrollToBottom);

  $: streamRendered = renderMarkdown($currentStreamContent);
</script>

<div class="messages" bind:this={messagesContainer}>
  {#each $messages as msg, i (i)}
    <MessageBubble role={msg.role} content={msg.content} thinking={msg.thinking} />
  {/each}

  {#if $currentClassification}
    <ClassificationBadge complexity={$currentClassification.complexity} needsTools={$currentClassification.needsTools} />
  {/if}

  {#if $isStreaming}
    <div class="message">
      <div class="message-role">Cortex</div>

      {#if $currentStreamThinking}
        <div class="thinking-panel">
          <div class="thinking-toggle">▾ Thinking</div>
          <div class="thinking-content">{$currentStreamThinking}</div>
        </div>
      {/if}

      <div class="message-content">{@html streamRendered}</div>
    </div>
  {/if}

  {#each $toolConfirmations as tc (tc.toolCallId)}
    <ToolConfirmCard toolCallId={tc.toolCallId} tool={tc.tool} args={tc.args} status={tc.status} />
  {/each}

  {#if $errorMessage}
    <div class="error-message">{$errorMessage}</div>
  {/if}
</div>

<style>
  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
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
    color: var(--vscode-textLink-foreground);
    user-select: none;
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
  .error-message {
    background: var(--vscode-inputValidation-errorBackground);
    border: 1px solid var(--vscode-inputValidation-errorBorder);
    color: var(--vscode-errorForeground);
    padding: 8px;
    border-radius: 4px;
    font-size: 12px;
  }
</style>

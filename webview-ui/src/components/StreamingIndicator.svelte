<script lang="ts">
  import { isStreaming } from '../stores/chat';
</script>

<div class="streaming-indicator" class:active={$isStreaming}>
  <span class="streaming-dot"></span>
  <span>Cortex is thinking...</span>
</div>

<style>
  .streaming-indicator {
    display: none;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    font-size: 11px;
    opacity: 0.7;
  }
  .streaming-indicator.active { display: flex; }
  .streaming-dot {
    width: 6px;
    height: 6px;
    background: var(--vscode-textLink-foreground);
    border-radius: 50%;
    animation: pulse 1.2s infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }
</style>

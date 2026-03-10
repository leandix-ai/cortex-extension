<script lang="ts">
  export let complexity: string;
  export let needsTools: boolean;
</script>

<div class="classification-badge-wrapper">
  <div class="classification-badge">
    <svg viewBox="0 0 16 16"><path d="M8 2a6 6 0 100 12A6 6 0 008 2zM4 8l2.5 2.5 5-5-.7-.7L6.5 9.1 4.7 7.3 4 8z"/></svg>
    Routing: <strong>{complexity}</strong> {needsTools ? '(Tools Enabled)' : '(Fast Stream)'}
  </div>
</div>

<style>
  .classification-badge-wrapper {
    align-items: center;
    margin: 4px 0;
  }
  .classification-badge {
    font-size: 10px;
    padding: 3px 8px;
    border-radius: 12px;
    background: var(--vscode-editorInfo-background, rgba(0, 120, 212, 0.1));
    color: var(--vscode-editorInfo-foreground, #0078d4);
    display: inline-flex;
    align-items: center;
    gap: 4px;
    opacity: 0.8;
    border: 1px solid var(--vscode-editorInfo-background, rgba(0, 120, 212, 0.2));
  }
  .classification-badge svg {
    width: 10px;
    height: 10px;
    fill: currentColor;
  }
</style>

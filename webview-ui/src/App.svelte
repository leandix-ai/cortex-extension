<script lang="ts">
  import Header from './components/Header.svelte';
  import HistoryPanel from './components/HistoryPanel.svelte';
  import MessageList from './components/MessageList.svelte';
  import StreamingIndicator from './components/StreamingIndicator.svelte';
  import InputArea from './components/InputArea.svelte';
  import {
    startStreaming, endStreaming, appendStreamContent, appendStreamThinking,
    setHistory, setConversationList, setProfile, setClassification,
    addToolConfirmation, setError, activeConversationId,
    type ChatMessage,
  } from './stores/chat';
  import { mentionResults, mentionActive, mentionSelectedIndex } from './stores/ui';

  // Listen for messages from the extension host
  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'streamStart':
        startStreaming();
        break;
      case 'content':
        appendStreamContent(msg.token);
        break;
      case 'thinking':
        appendStreamThinking(msg.token);
        break;
      case 'streamEnd':
        endStreaming();
        break;
      case 'error':
        setError(msg.message);
        break;
      case 'classification':
        setClassification(msg.classification);
        break;
      case 'profileChanged':
        setProfile(msg.profile, msg.model || '');
        break;
      case 'history':
        const filteredMsgs: ChatMessage[] = (msg.messages || []).filter(
          (m: any) => m.role === 'user' || m.role === 'assistant'
        );
        setHistory(filteredMsgs);
        break;
      case 'conversationList':
        if (msg.conversations?.length > 0) {
          const currentId = $activeConversationId;
          const exists = msg.conversations.some((c: any) => c.id === currentId);
          if (!exists) {
            activeConversationId.set(msg.conversations[0].id);
          }
        }
        setConversationList(msg.conversations || []);
        break;
      case 'searchResults':
        if ($mentionActive) {
          mentionResults.set(msg.results || []);
          mentionSelectedIndex.set(0);
        }
        break;
      case 'toolConfirm':
        addToolConfirmation({
          toolCallId: msg.toolCallId,
          tool: msg.tool,
          args: msg.args || {},
        });
        break;
    }
  });
</script>

<div class="app">
  <Header />
  <HistoryPanel />
  <MessageList />
  <StreamingIndicator />
  <InputArea />
</div>

<style>
  :global(*) { box-sizing: border-box; margin: 0; padding: 0; }

  :global(body) {
    font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    overflow: hidden;
  }

  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
    position: relative;
  }

  /* Scrollbar */
  :global(::-webkit-scrollbar) { width: 6px; }
  :global(::-webkit-scrollbar-track) { background: transparent; }
  :global(::-webkit-scrollbar-thumb) {
    background: var(--vscode-scrollbarSlider-background);
    border-radius: 3px;
  }
  :global(::-webkit-scrollbar-thumb:hover) {
    background: var(--vscode-scrollbarSlider-hoverBackground);
  }
</style>

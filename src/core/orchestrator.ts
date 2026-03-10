// ============================================================================
// Orchestrator — Main Coordinator
// The sole coordinator between all layers. Runs on Extension Host.
// Handles: prompt intake, context gathering, provider routing, streaming.
// ============================================================================

import * as vscode from 'vscode';
import {
  CortexProvider, Message, Token, ToolCallDelta,
  ProviderConfig, UserPromptPayload, StreamOptions,
} from '../core/types';
import { EventBus } from '../core/event-bus';
import { StateManager } from '../core/state-manager';
import { ConfigManager } from '../core/config-manager';
import { AIClassifier, LocalTokenCounter } from '../intelligence/classifier';
import { LSPContextGraph } from '../context/lsp-graph';
import { ToolExecutor, TOOL_DEFINITIONS } from '../tools/ide-tools';
import { AgentLoop } from '../engine/agent-loop';
import { createProvider } from '../providers/factory';
import { isAiderInstalled } from '../aider/guard';
import { executeAider, executeAiderInTerminal, resolveFilesForEdit, AiderRequest } from '../aider/bridge';

export class Orchestrator {
  private eventBus: EventBus;
  private stateManager: StateManager;
  private configManager: ConfigManager;
  private classifier: AIClassifier;
  private tokenCounter: LocalTokenCounter;
  private contextGraph: LSPContextGraph;
  private toolExecutor: ToolExecutor;
  private agentLoop: AgentLoop;

  private currentProvider: CortexProvider | null = null;
  private currentProfileName = '';
  private abortController: AbortController | null = null;
  private projectRules = '';

  constructor(
    eventBus: EventBus,
    stateManager: StateManager,
    context: vscode.ExtensionContext,
    configManager: ConfigManager
  ) {
    this.eventBus = eventBus;
    this.stateManager = stateManager;
    this.configManager = configManager;
    this.classifier = new AIClassifier();
    this.tokenCounter = new LocalTokenCounter();
    this.contextGraph = new LSPContextGraph(this.tokenCounter);
    this.toolExecutor = new ToolExecutor(stateManager);
    this.agentLoop = new AgentLoop(eventBus, stateManager, this.toolExecutor);

    // Initialize provider from ~/.leandix/settings.json
    this.initializeProvider();

    // Hot-reload when config file changes
    this.configManager.onConfigChange(() => {
      this.initializeProvider();
    });

    // Load project rules
    this.loadProjectRules();

    // Register event handlers
    this.eventBus.on<UserPromptPayload>('USER_PROMPT', async (event) => {
      await this.handlePrompt(event.payload);
    });

    this.eventBus.on('CANCEL_REQUEST', () => {
      this.cancelCurrentRequest();
    });
  }

  // --- Provider Management ---

  private initializeProvider(): void {
    const config = this.configManager.get();
    const { providers, activeProfile } = config;

    const profileConfig = providers[activeProfile];
    if (!profileConfig) {
      vscode.window.showErrorMessage(
        `Cortex: Provider profile "${activeProfile}" not found in ~/.leandix/settings.json`
      );
      return;
    }

    // Check if API key is still placeholder
    if (profileConfig.apiKey === 'YOUR_ANTHROPIC_API_KEY') {
      vscode.window.showWarningMessage(
        'Cortex: Please set your API key in ~/.leandix/settings.json',
        'Open Config'
      ).then((choice) => {
        if (choice === 'Open Config') {
          vscode.commands.executeCommand('cortex.openConfig');
        }
      });
      return;
    }

    try {
      this.currentProvider = createProvider(profileConfig);
      this.currentProfileName = activeProfile;
      this.eventBus.emit('PROFILE_CHANGED', {
        profile: activeProfile,
        model: profileConfig.model,
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Cortex: ${err.message}`, 'Open Config').then((choice) => {
        if (choice === 'Open Config') {
          vscode.commands.executeCommand('cortex.openConfig');
        }
      });
    }
  }

  async switchProfile(profileName: string): Promise<void> {
    await this.configManager.setActiveProfile(profileName);
    this.initializeProvider();
  }

  getCurrentProfile(): { name: string; model: string } {
    return {
      name: this.currentProfileName,
      model: this.currentProvider?.name || 'none',
    };
  }

  // --- Project Rules ---

  private async loadProjectRules(): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceRoot) return;

    const rulesFiles = [
      vscode.Uri.joinPath(workspaceRoot, '.leandix', 'rules.md'),
      vscode.Uri.joinPath(workspaceRoot, '.antigravity', 'rules.md'),
    ];

    for (const uri of rulesFiles) {
      try {
        const content = await vscode.workspace.fs.readFile(uri);
        this.projectRules += Buffer.from(content).toString('utf-8') + '\n';
      } catch {
        // File doesn't exist, skip
      }
    }
  }

  // --- Main Prompt Handler ---

  async handlePrompt(payload: UserPromptPayload): Promise<void> {
    if (!this.currentProvider) {
      this.eventBus.emit('STREAM_ERROR', { message: 'No provider configured. Set up cortex.providers in settings.json.' });
      return;
    }

    // Cancel any existing request
    this.cancelCurrentRequest();

    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const messageId = `msg_${Date.now()}`;

    // Set streaming context
    vscode.commands.executeCommand('setContext', 'cortex.isStreaming', true);
    this.eventBus.emit('STREAM_START', { messageId });

    try {
      // 1. Classify prompt using Fast Model (LLM API call)
      const classification = await this.classifier.classify(
        payload.prompt,
        this.currentProvider
      );

      // Emit classification event so UI can display it
      this.eventBus.emit('STREAM_CLASSIFICATION', {
        messageId,
        classification,
      });

      // 2. Gather context (< 300ms with fallback)
      const maxContextTokens = this.configManager.get().context.maxTokens;
      let contextFiles;

      try {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          const position = editor.selection.active;
          contextFiles = await this.contextGraph.buildContext(
            editor.document,
            position,
            maxContextTokens,
            300 // timeout ms
          );
        }
      } catch {
        // Fallback to flat context
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          contextFiles = await this.contextGraph.buildFlatContext(
            editor.document,
            maxContextTokens
          );
        }
      }

      contextFiles = contextFiles || [];

      this.eventBus.emit('CONTEXT_READY', {
        contextGraph: contextFiles,
        tokenCount: contextFiles.reduce(
          (sum, f) => sum + this.tokenCounter.estimate(f.content), 0
        ),
      });

      // 3. Build system prompt
      const systemPrompt = this.buildSystemPrompt(payload);

      // 4. Add user message to history
      const userMessage: Message = {
        role: 'user',
        content: payload.prompt,
        timestamp: Date.now(),
      };
      this.stateManager.addMessage(userMessage);

      // 5. Get conversation history
      const messages = this.stateManager.getRecentMessages(20);

      // 6. Stream options
      const streamOptions: StreamOptions = {
        maxTokens: classification.estimatedTokens,
      };

      // 7. Route: complex+mutating → Aider CLI, other tools → AgentLoop, no tools → Direct Stream
      let assistantContent = '';
      let assistantThinking = '';

      if (classification.needsTools) {
        if (classification.complexity === 'complex' && classification.needsMutatingTools) {
          // Aider CLI delegation path
          const aiderContent = await this.handleAiderDelegation(payload, messageId, signal);
          assistantContent = aiderContent;
        } else {
          // Agent Loop Path for readonly tools
          const result = await this.agentLoop.run(
            this.currentProvider,
            messages,
            systemPrompt,
            contextFiles,
            signal,
            messageId,
            streamOptions
          );
          assistantContent = result.finalContent;
          assistantThinking = result.thinking;
        }
      } else {
        // Direct Stream Path (Uses Fast Model only, NO TOOLS)
        const contextBlock = contextFiles
          .map((f) => `--- ${f.filePath} ---\n${f.content}`)
          .join('\n\n');

        const fullSystemPrompt = contextBlock
          ? `${systemPrompt}\n\nRelevant code context:\n${contextBlock}`
          : systemPrompt;

        const stream = this.currentProvider.stream(
          messages,
          fullSystemPrompt,
          [], // Empty tools array!
          signal,
          streamOptions
        );

        for await (const chunk of stream) {
          if (signal.aborted) break;
          // We don't expect tool calls here since we didn't pass tools
          if ('type' in chunk && chunk.type === 'content') {
            assistantContent += chunk.text;
            this.eventBus.emit('STREAM_CONTENT', {
              token: chunk.text, type: 'content', messageId, source: 'fast',
            });
          }
        }
      }

      // 8. Save assistant message to history
      this.stateManager.addMessage({
        role: 'assistant',
        content: assistantContent,
        thinking: assistantThinking,
        timestamp: Date.now(),
      });

      this.eventBus.emit('STREAM_END', { messageId });
      this.eventBus.emit('ACTION_COMPLETE', {
        actionId: messageId,
        summary: `Completed: ${payload.prompt.slice(0, 50)}...`,
      });

    } catch (err: any) {
      if (err.name === 'AbortError' || signal.aborted) {
        this.eventBus.emit('STREAM_END', { messageId });
      } else {
        console.error('[Orchestrator] Error:', err);
        this.eventBus.emit('STREAM_ERROR', {
          message: err.message || 'An error occurred',
        });
        this.eventBus.emit('STREAM_END', { messageId });
      }
    } finally {
      vscode.commands.executeCommand('setContext', 'cortex.isStreaming', false);
      this.abortController = null;
    }
  }

  cancelCurrentRequest(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private buildSystemPrompt(payload: UserPromptPayload): string {
    const parts: string[] = [
      'You are Cortex, an expert AI coding assistant embedded in the IDE.',
      'You have direct access to the user\'s codebase through tools.',
      'Be concise, precise, and focus on the code.',
    ];

    // Add project rules
    if (this.projectRules) {
      parts.push(`\nProject rules:\n${this.projectRules}`);
    }

    // Add active file context
    if (payload.filePath) {
      parts.push(`\nCurrently active file: ${payload.filePath}`);
    }

    if (payload.selection) {
      parts.push(`\nUser's selected code:\n\`\`\`\n${payload.selection}\n\`\`\``);
    }

    return parts.join('\n');
  }

  // --- Aider CLI Delegation ---

  private async handleAiderDelegation(
    payload: UserPromptPayload,
    messageId: string,
    signal: AbortSignal,
  ): Promise<string> {
    const config = this.configManager.get();
    const aiderConfig = config.aider ?? { enabled: true, path: 'aider', model: 'claude-sonnet-4-20250514', timeout: 120 };

    // Check if Aider is enabled in config
    if (!aiderConfig.enabled) {
      // Fall back to agent loop
      const streamOptions: StreamOptions = {
        maxTokens: 8192,
      };
      const result = await this.agentLoop.run(
        this.currentProvider!,
        this.stateManager.getRecentMessages(20),
        this.buildSystemPrompt(payload),
        [],
        signal,
        messageId,
        streamOptions
      );
      return result.finalContent;
    }

    // Lazy check: is aider installed?
    if (!(await isAiderInstalled(aiderConfig.path))) {
      // Emit not_installed event
      this.eventBus.emit('AIDER_DELEGATED', {
        messageId,
        status: 'not_installed',
        message: 'Aider CLI chưa được cài đặt.',
      });

      // Show install notification
      const choice = await vscode.window.showWarningMessage(
        'Cortex: File editing requires Aider CLI. Install it to enable this feature.',
        'Install Guide',
        'Dismiss'
      );
      if (choice === 'Install Guide') {
        vscode.env.openExternal(
          vscode.Uri.parse('https://aider.chat/docs/install.html')
        );
      }

      // Return fallback message
      const fallbackMsg = '⚠️ Aider CLI chưa được cài đặt. Chạy `pip install aider-chat` để cài đặt, sau đó thử lại.';
      this.eventBus.emit('STREAM_CONTENT', {
        token: fallbackMsg,
        type: 'content',
        messageId,
        source: 'fast',
      });
      return fallbackMsg;
    }

    // Aider is installed — notify and execute
    this.eventBus.emit('AIDER_DELEGATED', {
      messageId,
      status: 'started',
      message: 'Đang chuyển request tới Aider CLI để xử lý...',
    });

    this.eventBus.emit('STREAM_CONTENT', {
      token: '⚙️ Đang chuyển request tới Aider CLI để xử lý...\n',
      type: 'content',
      messageId,
      source: 'fast',
    });

    // Resolve files and API keys
    const files = resolveFilesForEdit();
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '.';

    console.log('[Orchestrator] Aider delegation — files:', files);
    console.log('[Orchestrator] Aider delegation — workspaceRoot:', workspaceRoot);
    console.log('[Orchestrator] Aider delegation — model:', aiderConfig.model);

    const envVars: Record<string, string> = {};

    // 1. Setup API Keys
    if (!aiderConfig.apiKey || aiderConfig.apiKey === 'YOUR_AIDER_API_KEY') {
      const fallbackMsg = '⚠️ Aider CLI yêu cầu cấu hình `aider.apiKey` riêng để hoạt động. Vui lòng thiết lập trong `~/.leandix/settings.json` rồi thử lại.';

      this.eventBus.emit('AIDER_DELEGATED', {
        messageId,
        status: 'error',
        message: 'Thiếu cấu hình Aider API Key.',
      });

      this.eventBus.emit('STREAM_CONTENT', {
        token: fallbackMsg + '\n',
        type: 'content',
        messageId,
        source: 'fast',
      });
      return fallbackMsg;
    }

    if (aiderConfig.model.includes('claude')) {
      envVars['ANTHROPIC_API_KEY'] = aiderConfig.apiKey;
    } else {
      envVars['OPENAI_API_KEY'] = aiderConfig.apiKey;
    }

    // 2. Setup Base URL
    if (aiderConfig.baseURL) {
      if (aiderConfig.model.includes('claude')) {
        // According to LiteLLM / Aider, anthropic supports ANTHROPIC_API_BASE
        envVars['ANTHROPIC_API_BASE'] = aiderConfig.baseURL;
      } else {
        // OpenAI standard
        envVars['OPENAI_API_BASE'] = aiderConfig.baseURL;
      }
    }

    const aiderReq: AiderRequest = {
      message: payload.prompt,
      files,
      model: aiderConfig.model,
      workspaceRoot,
      envVars,
      aiderPath: aiderConfig.path,
      timeout: aiderConfig.timeout,
    };

    // Show confirmation dialog before executing
    const toolCallId = `aider_confirm_${Date.now()}`;

    // Yêu cầu confirm qua WebUI thay vì vscode dialog
    this.eventBus.emit('TOOL_CONFIRM_REQUEST', {
      toolCallId,
      tool: 'Aider WebUI Terminal Mở Rộng',
      args: {
        command: `aider ...`,
      },
      messageId,
    });

    const approved = await this.waitForConfirmation(toolCallId, signal);

    if (!approved) {
      const summary = `\n🚫 Yêu cầu chạy Aider đã bị hủy bởi người dùng.`;

      this.eventBus.emit('AIDER_DELEGATED', {
        messageId,
        status: 'cancelled',
        message: summary,
        editedFiles: [],
      });

      this.eventBus.emit('STREAM_CONTENT', {
        token: '\n' + summary,
        type: 'content',
        messageId,
        source: 'fast',
      });

      return summary;
    }

    // Execute in the VS Code terminal automatically
    await executeAiderInTerminal(aiderReq);

    const summary = `\n✅ Đã chạy Aider trong terminal.`;

    this.eventBus.emit('AIDER_DELEGATED', {
      messageId,
      status: 'completed',
      message: summary,
      editedFiles: [],
    });

    this.eventBus.emit('STREAM_CONTENT', {
      token: '\n' + summary,
      type: 'content',
      messageId,
      source: 'fast',
    });

    return summary;
  }

  /**
   * Wait for user confirmation via TOOL_CONFIRM_RESPONSE event.
   * Returns true if approved, false if denied or aborted.
   */
  private waitForConfirmation(toolCallId: string, signal: AbortSignal): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      // Listen for response matching this toolCallId
      const unsubscribe = this.eventBus.on('TOOL_CONFIRM_RESPONSE', (event: any) => {
        if (event.payload.toolCallId === toolCallId) {
          unsubscribe();
          resolve(event.payload.approved === true);
        }
      });

      // Also resolve on abort so we don't hang forever
      const onAbort = () => {
        unsubscribe();
        resolve(false);
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  dispose(): void {
    this.cancelCurrentRequest();
    this.contextGraph.clearCache();
  }
}

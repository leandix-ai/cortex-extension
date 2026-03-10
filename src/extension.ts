// ============================================================================
// Extension Entry Point — Activate / Deactivate
// Wires all five layers together via the Event Bus.
// Target: < 100ms activation, < 500KB bundle.
// ============================================================================

import * as vscode from 'vscode';
import { EventBus } from './core/event-bus';
import { StateManager } from './core/state-manager';
import { ConfigManager } from './core/config-manager';
import { Orchestrator } from './core/orchestrator';
import { SidebarProvider } from './ui/sidebar/sidebar-provider';
import { InlineChatHandler } from './ui/inline/inline-chat';
import { EditorManipulator } from './tools/editor-manipulator';

let orchestrator: Orchestrator;
let stateManager: StateManager;
let eventBus: EventBus;
let configManager: ConfigManager;
let sidebarProvider: SidebarProvider;
let inlineChatHandler: InlineChatHandler;
let editorManipulator: EditorManipulator;

export function activate(context: vscode.ExtensionContext): void {
  const startTime = Date.now();

  // --- Core Layer ---
  eventBus = new EventBus();
  stateManager = new StateManager(context);
  configManager = new ConfigManager();

  // --- Orchestrator Layer ---
  orchestrator = new Orchestrator(eventBus, stateManager, context, configManager);

  // --- Tools Layer ---
  editorManipulator = new EditorManipulator(stateManager);

  // --- Presentation Layer ---
  sidebarProvider = new SidebarProvider(context.extensionUri, eventBus, stateManager, () => orchestrator.getCurrentProfile());
  inlineChatHandler = new InlineChatHandler(eventBus, stateManager);

  // --- Register Webview Provider ---
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewType,
      sidebarProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // --- Register CodeLens Provider ---
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: 'file' },
      editorManipulator
    )
  );

  // --- Register Commands ---
  context.subscriptions.push(
    vscode.commands.registerCommand('cortex.openChat', () => {
      vscode.commands.executeCommand('cortex.chatView.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cortex.inlineChat', () => {
      inlineChatHandler.activate();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cortex.undoLastSession', () => {
      editorManipulator.undoLastSession();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cortex.cancelRequest', () => {
      eventBus.emit('CANCEL_REQUEST', {});
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cortex.newConversation', () => {
      stateManager.createConversation();
      sidebarProvider.notifyConversationChanged();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cortex.acceptChange', (changeId: string) => {
      editorManipulator.acceptChange(changeId);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cortex.rejectChange', (changeId: string) => {
      editorManipulator.rejectChange(changeId);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cortex.switchProfile', async () => {
      const config = configManager.get();
      const { providers, activeProfile } = config;
      const profileNames = Object.keys(providers);

      if (profileNames.length === 0) {
        vscode.window.showWarningMessage('No provider profiles configured.');
        return;
      }

      const selected = await vscode.window.showQuickPick(
        profileNames.map((name) => ({
          label: name,
          description: providers[name].model,
          detail: name === activeProfile ? '● Active' : '',
        })),
        { placeHolder: 'Select a provider profile' }
      );

      if (selected) {
        orchestrator.switchProfile(selected.label);
        vscode.window.showInformationMessage(
          `Cortex: Switched to ${selected.label} (${providers[selected.label].model})`
        );
      }
    })
  );

  // --- Open Config Command ---
  context.subscriptions.push(
    vscode.commands.registerCommand('cortex.openConfig', async () => {
      const configPath = configManager.getConfigPath();
      const uri = vscode.Uri.file(configPath);
      await vscode.window.showTextDocument(uri, { preview: false });
    })
  );

  // --- Status Bar ---
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right, 100
  );
  statusBar.command = 'cortex.switchProfile';
  statusBar.tooltip = 'Click to switch Cortex provider profile';
  context.subscriptions.push(statusBar);

  // Update status bar on profile change
  eventBus.on('PROFILE_CHANGED', (event) => {
    const { profile, model } = event.payload as { profile: string; model: string };
    statusBar.text = `$(sparkle) Cortex: ${profile}`;
    statusBar.show();
  });

  // Show streaming status
  eventBus.on('STREAM_START', () => {
    statusBar.text = `$(sync~spin) Cortex: streaming...`;
  });

  eventBus.on('STREAM_END', () => {
    const current = orchestrator.getCurrentProfile();
    statusBar.text = `$(sparkle) Cortex: ${current.name}`;
  });

  // --- Persist state on deactivate ---
  context.subscriptions.push({
    dispose: () => {
      stateManager.persistState();
      configManager.dispose();
    },
  });

  const activationTime = Date.now() - startTime;
  console.log(`[Cortex] Activated in ${activationTime}ms`);

  if (activationTime > 100) {
    console.warn(`[Cortex] Activation exceeded 100ms target: ${activationTime}ms`);
  }
}

export function deactivate(): void {
  orchestrator?.dispose();
  stateManager?.dispose();
  editorManipulator?.dispose();
  sidebarProvider?.dispose();
  eventBus?.removeAll();
  console.log('[Cortex] Deactivated');
}

<div align="center">

# 🧠 Leandix Cortex

**IDE-native AI Coding Assistant**

[![VS Code](https://img.shields.io/badge/VS_Code-%5E1.85.0-007ACC?logo=visual-studio-code&logoColor=white)](https://code.visualstudio.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Svelte](https://img.shields.io/badge/Svelte-UI-FF3E00?logo=svelte&logoColor=white)](https://svelte.dev/)

An AI-powered coding assistant that lives inside your editor — featuring Extended Thinking, multi-provider support, LSP-based context awareness, agentic tool calling, and full session undo.

Built from first principles: **zero-latency startup** · **minimal footprint** · **true streaming**

</div>

---

## ✨ Features

| Feature                 | Description                                                                    |
| ----------------------- | ------------------------------------------------------------------------------ |
| 🧠 **Extended Thinking** | Native support for Claude's thinking tags, rendered in a collapsible panel     |
| 🔌 **Multi-Provider**    | Anthropic (native) + OpenAI-compatible (Gemini, Ollama, LM Studio, etc.)       |
| 🔗 **LSP Context Graph** | Symbol-level dependency traversal for precise, relevant code context           |
| ↩️ **AI Action Stack**   | Full session undo — roll back all AI-initiated changes in one click            |
| 🤖 **Agent Loop**        | Iterative tool calling: read, write, edit files, search codebase, run terminal |
| 💬 **Inline Chat**       | CodeLens-based interaction without leaving the editor                          |
| 🔒 **Tool Security**     | Mandatory user confirmation for destructive actions (write, edit, terminal)    |
| 📝 **Aider Integration** | Bridge to Aider for advanced multi-file editing workflows                      |

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────┐
│                  PRESENTATION LAYER                  │
│  Inline Chat (CodeLens)   │ Sidebar (Svelte WebView) │
│                           │ + Tool Confirmation      │
└─────────────┬────────────────────────────────────────┘
              │ Events (postMessage) & Approvals
┌─────────────▼────────────────────────────────────────┐
│                  ORCHESTRATOR LAYER                  │
│  Event Bus   │   State Manager   │  AI Action Stack  │
└──────┬───────────────────────────┬───────────────────┘
       │                           │
┌──────▼──────┐      ┌─────────────▼───────────────────┐
│ LOCAL INTEL │      │            AI ENGINE            │
│ Classifier  │      │  Provider Abstraction (Factory) │
│ Token Count │      │  Stream Parser + Thinking Tags  │
│ 0ms Offline │      │  Agent Loop (iterative tools)   │
│             │      │  ➥ Pauses for Confirmation      │
└──────┬──────┘      └─────────────┬───────────────────┘
       │                           │
┌──────▼───────────────────────────▼───────────────────┐
│                CONTEXT & TOOLS LAYER                 │
│  LSP Context Graph │ Editor Manipulator │  Terminal  │
└──────────────────────────────────────────────────────┘
```

## 📁 Project Structure

```
leandix-cortex/
├── src/                        # Extension backend (TypeScript)
│   ├── extension.ts            # Extension entry point & activation
│   ├── core/                   # Core orchestration layer
│   │   ├── orchestrator.ts     # Main request orchestrator
│   │   ├── state-manager.ts    # Session & AI action stack state
│   │   ├── event-bus.ts        # Decoupled event system
│   │   ├── config-manager.ts   # Provider & workspace configuration
│   │   ├── thinking-parser.ts  # Claude thinking tag parser
│   │   ├── sse-buffer.ts       # Server-sent events buffer
│   │   └── types.ts            # Shared TypeScript interfaces
│   ├── engine/
│   │   └── agent-loop.ts       # Agentic tool-calling loop
│   ├── providers/              # AI provider abstraction
│   │   ├── factory.ts          # Provider factory
│   │   ├── anthropic-compat.ts # Anthropic API integration
│   │   └── openai-compat.ts    # OpenAI-compatible API integration
│   ├── context/
│   │   └── lsp-graph.ts        # LSP-based symbol dependency graph
│   ├── intelligence/
│   │   └── classifier.ts       # Local intent classifier (offline)
│   ├── tools/                  # IDE tool implementations
│   │   ├── ide-tools.ts        # File read/write/search/terminal tools
│   │   └── editor-manipulator.ts # Code diff & apply engine
│   ├── ui/
│   │   ├── sidebar/            # Sidebar webview provider
│   │   └── inline/             # Inline chat (CodeLens)
│   ├── aider/                  # Aider integration bridge
│   └── test/                   # Test suite (Mocha + Sinon)
│       └── suite/              # Unit tests for all modules
├── webview-ui/                 # Sidebar UI (Svelte + Vite)
│   └── src/
│       ├── App.svelte          # Root application component
│       ├── components/         # UI components
│       │   ├── Header.svelte
│       │   ├── MessageList.svelte
│       │   ├── MessageBubble.svelte
│       │   ├── InputArea.svelte
│       │   ├── MentionMenu.svelte
│       │   ├── HistoryPanel.svelte
│       │   ├── ToolConfirmCard.svelte
│       │   ├── StreamingIndicator.svelte
│       │   └── ClassificationBadge.svelte
│       ├── stores/             # Svelte stores (state management)
│       └── lib/                # Shared utilities
├── assets/                     # Static assets (icons)
├── build.js                    # esbuild bundler configuration
├── package.json                # Extension manifest & scripts
├── tsconfig.json               # TypeScript configuration
└── .vscodeignore               # Files excluded from VSIX package
```

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18
- [VS Code](https://code.visualstudio.com/) ≥ 1.85.0
- An API key from a supported provider

### Installation from Source

```bash
# 1. Install dependencies
npm install
cd webview-ui
npm install
cd ..

# 2. Compile the extension
npm run compile

# 3. Package as VSIX
npm run package

# 4. Install in VS Code / Antigravity
code --install-extension leandix-cortex-0.1.0.vsix --force
antigravity --install-extension leandix-cortex-0.1.0.vsix --force
```

### Provider Configuration

Create (or open) your config file at `~/.leandix/settings.json`:

```jsonc
{
  "activeProfile": "default",
  "context": {
    "maxTokens": 80000
  },
  "agentLoop": {
    "maxIterations": 15
  },
  "providers": {
    "default": {
      "model": "claude-sonnet-4-5",
      "apiKey": "YOUR_ANTHROPIC_API_KEY",
      "baseURL": "https://api.anthropic.com",
      "smartModel": {
        "model": "claude-sonnet-4-5",
        "apiKey": "YOUR_ANTHROPIC_API_KEY",
        "baseURL": "https://api.anthropic.com"
      }
    }
  }
}
```

> [!TIP]
> You can define multiple named profiles under `providers` and switch between them at runtime using **Cortex: Switch Provider Profile**.

## ⌨️ Keyboard Shortcuts

| Shortcut       | macOS       | Action                               |
| -------------- | ----------- | ------------------------------------ |
| `Ctrl+Shift+L` | `⌘+Shift+L` | Open Cortex Chat sidebar             |
| `Ctrl+Shift+I` | `⌘+Shift+I` | Inline Chat (with current selection) |
| `Escape`       | `Escape`    | Cancel current streaming request     |
| `Ctrl+Shift+Z` | `⌘+Shift+Z` | Undo last AI session                 |

## 🔌 Provider Compatibility

| Provider                       | Type            | Extended Thinking | Tool Calling | Offline |
| ------------------------------ | --------------- | :---------------: | :----------: | :-----: |
| Claude (Haiku / Sonnet / Opus) | `anthropic`     |     ✅ Native      |      ✅       |    ❌    |
| Gemini Flash / Pro             | `openai-compat` |         ❌         |      ✅       |    ❌    |
| Ollama (any model)             | `openai-compat` |     Model-dep     |  Model-dep   |    ✅    |
| LM Studio                      | `openai-compat` |     Model-dep     |  Model-dep   |    ✅    |

## ⚙️ Configuration

### Project Rules

Create a `.leandix/rules.md` file in your workspace root to define project-specific instructions for the AI:

```markdown
## Code Style
- Always use async/await
- Prefer explicit return types

## Constraints
- Never modify migration files
- Use English for all comments
```

### Security & Tool Confirmation

All destructive operations (file writes, edits, terminal commands) require explicit user approval. Configure policies in your settings:

```jsonc
{
  "cortex.terminal.policy": "request-review",
  "cortex.terminal.allowList": ["npm", "git", "python"],
  "cortex.terminal.denyList": ["rm -rf", "DROP TABLE"]
}
```

## 🛠️ Development

### Scripts

| Command                 | Description                        |
| ----------------------- | ---------------------------------- |
| `npm run compile`       | Build webview + compile TypeScript |
| `npm run watch`         | Watch mode for extension backend   |
| `npm run dev:webview`   | Dev server for Svelte webview UI   |
| `npm run build:webview` | Production build for webview UI    |
| `npm run test`          | Run unit tests (Mocha)             |
| `npm run test:vscode`   | Run VS Code integration tests      |
| `npm run package`       | Package extension as `.vsix`       |

### Tech Stack

- **Extension Host**: TypeScript, compiled with esbuild
- **Webview UI**: Svelte + Vite
- **Testing**: Mocha + Sinon
- **Packaging**: `@vscode/vsce`

### Running in Development

1. Open the project in VS Code
2. Run `npm run watch` in a terminal for backend hot-reload
3. Run `npm run dev:webview` in another terminal for webview hot-reload
4. Press `F5` to launch the Extension Development Host

## 📄 License

This project is licensed under the [MIT License](./LICENSE).

---

<div align="center">

Made with ❤️ by **Leandix Engineering**

</div>

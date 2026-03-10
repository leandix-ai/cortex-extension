# Cortex × Aider Integration — Cấp 3: Non-Interactive Mode

## Tổng quan kiến trúc

```
┌─────────────────────────────────────────────────┐
│                  VS Code IDE                     │
│                                                  │
│  ┌───────────────────────────────────────────┐   │
│  │         Cortex Extension (TypeScript)      │   │
│  │                                           │   │
│  │  ┌─────────┐   ┌──────────┐   ┌────────┐ │   │
│  │  │ Chat UI │──▶│ Planner  │──▶│ Router │ │   │
│  │  │ Webview │   │ (Claude) │   │        │ │   │
│  │  └─────────┘   └──────────┘   └───┬────┘ │   │
│  │                                   │      │   │
│  │                    ┌──────────────┼──┐   │   │
│  │                    ▼              ▼  │   │   │
│  │              ┌──────────┐  ┌────────┐│   │   │
│  │              │ Internal │  │ Aider  ││   │   │
│  │              │ Response │  │ Bridge ││   │   │
│  │              │ (chat/   │  │        ││   │   │
│  │              │  explain)│  └───┬────┘│   │   │
│  │              └──────────┘      │     │   │   │
│  └────────────────────────────────┼─────┘   │
│                                   │         │
│  ┌────────────────────────────────▼───────┐ │
│  │          Aider CLI (Python)            │ │
│  │  aider --message "..." --yes --no-git  │ │
│  │                                        │ │
│  │  • Đọc/ghi file trực tiếp             │ │
│  │  • Gọi LLM API (Anthropic/OpenAI)     │ │
│  │  • Output: file changes + stdout log   │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

## Luồng xử lý chính (Flow)

### Step 1: User gửi request editing qua Cortex Chat

```
User: "Refactor hàm calculatePrice trong src/pricing.ts, tách validation ra function riêng"
```

### Step 2: Cortex Planner phân loại intent

Router trong Cortex nhận message, classify thành 2 loại:

- **Internal**: giải thích code, trả lời câu hỏi, review → Cortex tự xử lý qua LLM API
- **Edit**: tạo file, sửa file, refactor → delegate xuống Aider Bridge

Classification có thể đơn giản bằng keyword matching ban đầu, hoặc dùng LLM call nhẹ (Haiku) để classify chính xác hơn.

### Step 3: Aider Bridge build command

```typescript
// src/aider/bridge.ts

interface AiderRequest {
  message: string;
  files: string[];        // files liên quan, lấy từ context
  model?: string;         // default: claude-sonnet
  workspaceRoot: string;
  autoCommit: boolean;    // default: false cho integration
}

function buildAiderCommand(req: AiderRequest): string[] {
  const args = [
    'aider',
    '--message', req.message,
    '--yes',               // auto-accept all edits
    '--no-auto-commits',   // Cortex quản lý git, không để Aider commit
    '--no-pretty',         // output dạng plain text, dễ parse
    '--no-stream',         // đợi kết quả đầy đủ
    '--model', req.model ?? 'claude-sonnet-4-20250514',
  ];

  // Chỉ định files cụ thể thay vì để Aider scan toàn bộ repo
  for (const file of req.files) {
    args.push('--file', file);
  }

  return args;
}
```

### Step 4: Spawn Aider process

```typescript
// src/aider/executor.ts

import { spawn } from 'child_process';
import * as vscode from 'vscode';

interface AiderResult {
  success: boolean;
  output: string;
  editedFiles: string[];
  error?: string;
}

async function executeAider(req: AiderRequest): Promise<AiderResult> {
  const args = buildAiderCommand(req);

  return new Promise((resolve) => {
    const proc = spawn(args[0], args.slice(1), {
      cwd: req.workspaceRoot,
      env: {
        ...process.env,
        // API key từ Cortex settings, không yêu cầu user config riêng
        ANTHROPIC_API_KEY: getApiKeyFromCortexConfig(),
      },
      timeout: 120_000, // 2 phút hard timeout
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      // Optional: stream partial output lên Cortex chat UI
      emitPartialOutput(data.toString());
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      const editedFiles = parseEditedFiles(stdout);

      resolve({
        success: code === 0,
        output: stdout,
        editedFiles,
        error: code !== 0 ? stderr : undefined,
      });
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        output: '',
        editedFiles: [],
        error: `Failed to spawn aider: ${err.message}`,
      });
    });
  });
}
```

### Step 5: Parse kết quả & hiển thị

```typescript
// src/aider/parser.ts

function parseEditedFiles(output: string): string[] {
  // Aider output format khi dùng --no-pretty:
  // "Wrote <path>" cho mỗi file đã sửa
  const pattern = /^Wrote\s+(.+)$/gm;
  const files: string[] = [];
  let match;
  while ((match = pattern.exec(output)) !== null) {
    files.push(match[1].trim());
  }
  return files;
}

async function showResultInUI(result: AiderResult): Promise<void> {
  if (!result.success) {
    // Hiện error trong chat panel
    sendToChatUI({
      role: 'assistant',
      content: `Edit failed: ${result.error}`,
      type: 'error',
    });
    return;
  }

  // Mở diff view cho từng file đã sửa
  for (const file of result.editedFiles) {
    // VS Code có sẵn git diff nếu trong repo
    // Hoặc dùng vscode.commands.executeCommand('vscode.diff', ...)
  }

  sendToChatUI({
    role: 'assistant',
    content: `Đã sửa ${result.editedFiles.length} file: ${result.editedFiles.join(', ')}`,
    type: 'success',
  });
}
```

## Quản lý file context

Vấn đề lớn nhất của cấp 3: Aider không giữ repo map giữa các lần gọi. Giải pháp:

```typescript
// src/aider/context.ts

function resolveFilesForEdit(
  userMessage: string,
  activeEditor: vscode.TextEditor | undefined,
  openEditors: vscode.TextEditor[],
): string[] {
  const files: string[] = [];

  // 1. File đang active → luôn include
  if (activeEditor) {
    files.push(activeEditor.document.uri.fsPath);
  }

  // 2. Files được mention trong message
  //    "sửa file src/pricing.ts" → extract path
  const mentioned = extractFilePathsFromMessage(userMessage);
  files.push(...mentioned);

  // 3. Files đang mở trong editor (related context)
  //    Giới hạn 5 files để không phình context
  const openPaths = openEditors
    .map(e => e.document.uri.fsPath)
    .filter(p => !files.includes(p))
    .slice(0, 5);
  files.push(...openPaths);

  return [...new Set(files)]; // dedupe
}
```

## Config trong extension settings

```jsonc
// package.json → contributes.configuration
{
  "cortex.aider.enabled": {
    "type": "boolean",
    "default": false,
    "description": "Enable Aider integration for file editing"
  },
  "cortex.aider.path": {
    "type": "string",
    "default": "aider",
    "description": "Path to aider binary"
  },
  "cortex.aider.model": {
    "type": "string",
    "default": "claude-sonnet-4-20250514",
    "description": "Model for Aider to use"
  },
  "cortex.aider.timeout": {
    "type": "number",
    "default": 120,
    "description": "Timeout in seconds for Aider operations"
  },
  "cortex.aider.autoCommit": {
    "type": "boolean",
    "default": false,
    "description": "Let Aider auto-commit changes (recommend: false)"
  }
}
```

## API Key: đọc từ Cortex config → inject vào Aider

Cortex lưu key trong file JSON config. Khi spawn Aider, đọc key từ file này rồi truyền qua env var — user chỉ config 1 lần, Aider tự nhận.

```typescript
// src/aider/keys.ts

import * as fs from 'fs';
import * as path from 'path';

interface CortexKeys {
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
}

function loadKeysFromCortexConfig(workspaceRoot: string): CortexKeys {
  const configPath = path.join(workspaceRoot, '.cortex', 'config.json');

  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return {
      ANTHROPIC_API_KEY: config.anthropicApiKey ?? undefined,
      OPENAI_API_KEY: config.openaiApiKey ?? undefined,
    };
  } catch {
    return {};
  }
}
```

Khi spawn Aider process, inject vào env:

```typescript
const keys = loadKeysFromCortexConfig(req.workspaceRoot);

const proc = spawn(aiderBin, args, {
  cwd: req.workspaceRoot,
  env: {
    ...process.env,
    ...keys, // Aider tự đọc ANTHROPIC_API_KEY / OPENAI_API_KEY từ env
  },
});
```

Aider tự detect env var, không cần flag `--api-key`. Key chỉ tồn tại trong env của child process — process kết thúc thì env biến mất.

> **Lưu ý bảo mật**: Về lâu dài nên chuyển từ plaintext JSON sang VS Code SecretStorage API (encrypt ở OS level):
> ```typescript
> // Lưu key (1 lần khi user nhập)
> await context.secrets.store('cortex.anthropicApiKey', key);
> // Đọc key (mỗi lần spawn Aider)
> const key = await context.secrets.get('cortex.anthropicApiKey');
> ```

---

## Lazy check: kiểm tra Aider khi cần

Không check Aider lúc extension activate. Chỉ kiểm tra khi user thực sự gửi lệnh edit/create/delete — nếu chưa cài thì hiện thông báo.

```typescript
// src/aider/guard.ts

import { exec as execCb } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCb);

async function isAiderInstalled(aiderPath: string): Promise<boolean> {
  try {
    await exec(`"${aiderPath}" --version`);
    return true;
  } catch {
    return false;
  }
}

async function withAider(
  req: AiderRequest,
  config: vscode.WorkspaceConfiguration
): Promise<AiderResult | null> {
  const aiderPath = config.get<string>('cortex.aider.path', 'aider');

  if (!(await isAiderInstalled(aiderPath))) {
    const choice = await vscode.window.showWarningMessage(
      'File editing requires Aider CLI. Install it to enable this feature.',
      'Install Guide',
      'Dismiss'
    );
    if (choice === 'Install Guide') {
      vscode.env.openExternal(
        vscode.Uri.parse('https://aider.chat/docs/install.html')
      );
    }
    return null; // Router hiển thị fallback message trong chat
  }

  return executeAider(req);
}
```

Router gọi `withAider()` thay vì `executeAider()` trực tiếp:

```typescript
// src/router.ts (simplified)

async function handleMessage(message: string): Promise<void> {
  const intent = classifyIntent(message);

  if (intent === 'edit') {
    const result = await withAider(
      { message, files: resolveFiles(message), workspaceRoot },
      vscode.workspace.getConfiguration()
    );

    if (result === null) {
      // Aider chưa cài → user đã thấy notification
      // Fallback: trả lời trong chat thay vì edit file
      sendToChatUI({
        role: 'assistant',
        content: 'Install Aider CLI to enable file editing. '
               + 'Run: pip install aider-chat',
        type: 'info',
      });
      return;
    }

    await showResultInUI(result);
  } else {
    await handleInternalResponse(message);
  }
}
```

User cài Aider xong → lần gọi tiếp tự hoạt động, không cần restart extension.

---

## Xử lý edge cases

### 1. Large file / long operation

```typescript
// Progress indicator trong VS Code
await vscode.window.withProgress(
  {
    location: vscode.ProgressLocation.Notification,
    title: 'Cortex: Editing files via Aider...',
    cancellable: true,
  },
  async (progress, token) => {
    token.onCancellationRequested(() => {
      proc.kill('SIGTERM');
    });

    const result = await executeAider(req);
    return result;
  }
);
```

### 4. Aider edit conflict với unsaved changes

```typescript
// Trước khi gọi Aider, save tất cả file liên quan
async function saveRelatedFiles(files: string[]): Promise<void> {
  for (const filePath of files) {
    const doc = vscode.workspace.textDocuments.find(
      d => d.uri.fsPath === filePath
    );
    if (doc?.isDirty) {
      await doc.save();
    }
  }
}
```

## Cost structure

Mỗi lần gọi Aider = 1 LLM API call riêng biệt (tách khỏi Cortex planning call).

```
Request "Refactor calculatePrice":
  ├── Cortex planning (Haiku classify)     ~0.001 USD
  ├── Aider edit (Sonnet + repo context)   ~0.01-0.05 USD
  └── Total per edit request               ~0.01-0.05 USD
```

Nếu muốn tiết kiệm: cho Aider dùng model rẻ hơn (Haiku, DeepSeek) cho edits đơn giản, chỉ dùng Sonnet cho refactor phức tạp. Config qua `cortex.aider.model`.

## Tóm tắt implementation steps

1. **Tạo `src/aider/` module** với 5 file: `keys.ts`, `guard.ts`, `bridge.ts`, `executor.ts`, `parser.ts`, `context.ts`
2. **Thêm route trong Router**: khi intent = edit → gọi `withAider()` (lazy check + execute)
3. **Thêm config** trong `package.json` contributes
4. **Wire UI**: hiển thị progress, diff view, error messages, install notification
5. **Test**: bắt đầu với single-file edit, sau đó multi-file

## Hạn chế của cấp 3 cần biết trước

- **Cold start mỗi lần**: Aider rebuild repo map → thêm 2-5s latency + token cost cho map
- **Không giữ conversation**: mỗi lần gọi là context mới, không thể nói "sửa tiếp chỗ vừa nãy"
- **Output parsing brittle**: Aider stdout format có thể thay đổi giữa versions
- **Double LLM cost**: Cortex + Aider gọi API riêng biệt

Nếu 3 hạn chế đầu trở thành pain point thực tế sau khi ship, đó là lúc nâng lên cấp 2 (persistent process).

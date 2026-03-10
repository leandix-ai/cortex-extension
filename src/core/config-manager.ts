// ============================================================================
// ConfigManager — Reads/writes ~/.leandix/settings.json
// Hot-reloads when file changes. Creates a default config if missing.
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ProviderConfig } from './types';

export interface CortexConfig {
  activeProfile: string;

  context: {
    maxTokens: number;
  };
  agentLoop: {
    maxIterations: number;
  };
  aider?: {
    enabled: boolean;
    path: string;
    model: string;
    timeout: number;
    apiKey?: string;
    baseURL?: string;
  };
  providers: Record<string, ProviderConfig>;
}

const DEFAULT_CONFIG: CortexConfig = {
  activeProfile: 'default',

  context: {
    maxTokens: 80000,
  },
  agentLoop: {
    maxIterations: 15,
  },
  aider: {
    enabled: true,
    path: 'aider',
    model: 'claude-sonnet-4-5',
    timeout: 120,
    apiKey: 'YOUR_AIDER_API_KEY',
    baseURL: 'https://api.anthropic.com',
  },
  providers: {
    default: {
      model: 'gpt-4o-mini',
      apiKey: 'YOUR_OPENAI_API_KEY',
      baseURL: 'https://api.openai.com',
    },
  },
};

export class ConfigManager {
  private configPath: string;
  private config: CortexConfig;
  private watcher: fs.FSWatcher | null = null;
  private changeListeners: Array<(config: CortexConfig) => void> = [];

  constructor(customConfigPath?: string) {
    if (customConfigPath) {
      this.configPath = customConfigPath;
    } else {
      const leandixDir = path.join(os.homedir(), '.leandix');
      this.configPath = path.join(leandixDir, 'settings.json');
    }

    this.config = this.loadOrCreate();
    this.startWatcher();
  }

  // --- Public API ---

  get(): CortexConfig {
    return this.config;
  }

  getConfigPath(): string {
    return this.configPath;
  }

  onConfigChange(listener: (config: CortexConfig) => void): void {
    this.changeListeners.push(listener);
  }

  async setActiveProfile(profileName: string): Promise<void> {
    this.config.activeProfile = profileName;
    this.save();
  }

  dispose(): void {
    this.watcher?.close();
    this.watcher = null;
    this.changeListeners = [];
  }

  // --- Private ---

  private loadOrCreate(): CortexConfig {
    const dir = path.dirname(this.configPath);

    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Create default config file if it doesn't exist
    if (!fs.existsSync(this.configPath)) {
      this.writeFile(DEFAULT_CONFIG);
      return { ...DEFAULT_CONFIG };
    }

    return this.readFile();
  }

  private readFile(): CortexConfig {
    try {
      const raw = fs.readFileSync(this.configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      return this.mergeWithDefaults(parsed);
    } catch (e: any) {
      console.error('[ConfigManager] Failed to parse settings.json:', e);
      // If it's a validation error, re-throw it
      if (e.message?.includes('Invalid config format')) {
        throw e;
      }
      // For JSON parse errors, recreate with default config
      console.log('[ConfigManager] Creating new config with default format...');
      this.writeFile(DEFAULT_CONFIG);
      return { ...DEFAULT_CONFIG };
    }
  }

  private writeFile(config: CortexConfig): void {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (e) {
      console.error('[ConfigManager] Failed to write settings.json:', e);
    }
  }

  private save(): void {
    this.writeFile(this.config);
  }

  private mergeWithDefaults(partial: Partial<CortexConfig>): CortexConfig {
    // Validate that the config has the required structure
    if (!partial.activeProfile || !partial.providers) {
      throw new Error(
        'Invalid config format. Config must include "activeProfile" and "providers". ' +
        'Please update ~/.leandix/settings.json to the new format.'
      );
    }

    return {
      activeProfile: partial.activeProfile,
      context: {
        maxTokens: partial.context?.maxTokens ?? DEFAULT_CONFIG.context.maxTokens,
      },
      agentLoop: {
        maxIterations: partial.agentLoop?.maxIterations ?? DEFAULT_CONFIG.agentLoop.maxIterations,
      },
      aider: partial.aider ? {
        enabled: partial.aider.enabled ?? DEFAULT_CONFIG.aider!.enabled,
        path: partial.aider.path ?? DEFAULT_CONFIG.aider!.path,
        model: partial.aider.model ?? DEFAULT_CONFIG.aider!.model,
        timeout: partial.aider.timeout ?? DEFAULT_CONFIG.aider!.timeout,
        apiKey: partial.aider.apiKey,
        baseURL: partial.aider.baseURL,
      } : DEFAULT_CONFIG.aider,
      providers: partial.providers,
    };
  }

  private startWatcher(): void {
    try {
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      this.watcher = fs.watch(this.configPath, () => {
        // Debounce rapid file-save events (e.g., from editors)
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const newConfig = this.readFile();
          this.config = newConfig;
          this.changeListeners.forEach((fn) => fn(newConfig));
        }, 300);
      });

      this.watcher.on('error', (err) => {
        console.warn('[ConfigManager] Watcher error:', err);
        this.watcher = null;
      });
    } catch (e) {
      console.warn('[ConfigManager] Could not start file watcher:', e);
    }
  }
}

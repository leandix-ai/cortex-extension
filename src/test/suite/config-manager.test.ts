// ============================================================================
// ConfigManager Unit Tests
// Uses a temp directory for each test to isolate file I/O.
// ============================================================================

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConfigManager, CortexConfig } from '../../core/config-manager';

suite('ConfigManager', () => {
    let tmpDir: string;

    setup(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-test-'));
    });

    teardown(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function configPath(): string {
        return path.join(tmpDir, 'settings.json');
    }

    test('creates default config file if not present', () => {
        const mgr = new ConfigManager(configPath());
        const config = mgr.get();

        assert.strictEqual(config.activeProfile, 'default');
        assert.strictEqual(config.context.maxTokens, 80000);
        assert.strictEqual(config.agentLoop.maxIterations, 15);
        assert.ok(config.providers['default']);
        assert.ok(fs.existsSync(configPath()));

        mgr.dispose();
    });

    test('reads and parses existing config', () => {
        const custom: CortexConfig = {
            activeProfile: 'myprofile',
            context: { maxTokens: 50000 },
            agentLoop: { maxIterations: 10 },
            providers: {
                myprofile: {
                    model: 'gpt-4o',
                    apiKey: 'sk-test',
                    baseURL: 'https://api.openai.com',
                },
            },
        };
        fs.writeFileSync(configPath(), JSON.stringify(custom, null, 2));

        const mgr = new ConfigManager(configPath());
        const config = mgr.get();

        assert.strictEqual(config.activeProfile, 'myprofile');
        assert.strictEqual(config.context.maxTokens, 50000);
        assert.strictEqual(config.agentLoop.maxIterations, 10);
        assert.strictEqual(config.providers['myprofile'].model, 'gpt-4o');

        mgr.dispose();
    });

    test('mergeWithDefaults fills missing optional fields', () => {
        // Write config with only required fields (missing context & agentLoop)
        const partial = {
            activeProfile: 'default',
            providers: {
                default: { model: 'gpt-4o', apiKey: 'sk-test' },
            },
        };
        fs.writeFileSync(configPath(), JSON.stringify(partial, null, 2));

        const mgr = new ConfigManager(configPath());
        const config = mgr.get();

        // Should fall back to defaults
        assert.strictEqual(config.context.maxTokens, 80000);
        assert.strictEqual(config.agentLoop.maxIterations, 15);

        mgr.dispose();
    });

    test('throws on invalid format — missing activeProfile', () => {
        const invalid = { providers: { x: { model: 'a' } } };
        fs.writeFileSync(configPath(), JSON.stringify(invalid, null, 2));

        assert.throws(() => {
            new ConfigManager(configPath());
        }, /Invalid config format/);
    });

    test('throws on invalid format — missing providers', () => {
        const invalid = { activeProfile: 'default' };
        fs.writeFileSync(configPath(), JSON.stringify(invalid, null, 2));

        assert.throws(() => {
            new ConfigManager(configPath());
        }, /Invalid config format/);
    });

    test('setActiveProfile persists change to disk', async () => {
        const mgr = new ConfigManager(configPath());

        await mgr.setActiveProfile('newprofile');

        const configOnDisk = JSON.parse(fs.readFileSync(configPath(), 'utf-8'));
        assert.strictEqual(configOnDisk.activeProfile, 'newprofile');
        assert.strictEqual(mgr.get().activeProfile, 'newprofile');

        mgr.dispose();
    });

    test('getConfigPath returns the correct path', () => {
        const mgr = new ConfigManager(configPath());
        assert.strictEqual(mgr.getConfigPath(), configPath());
        mgr.dispose();
    });

    test('dispose stops watcher without errors', () => {
        const mgr = new ConfigManager(configPath());
        assert.doesNotThrow(() => mgr.dispose());
        // Double dispose should also be safe
        assert.doesNotThrow(() => mgr.dispose());
    });

    test('recreates config when JSON is malformed', () => {
        fs.writeFileSync(configPath(), '{ broken json !!!');

        const mgr = new ConfigManager(configPath());
        const config = mgr.get();

        // Should recreate with defaults
        assert.strictEqual(config.activeProfile, 'default');
        assert.ok(config.providers['default']);

        mgr.dispose();
    });
});

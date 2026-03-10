// ============================================================================
// Provider Factory Unit Tests
// Tests detectProviderType, resolveEnvVars, createProvider.
// ============================================================================

import * as assert from 'assert';

// We need to test the private helpers, so we'll import the module and test
// through the public createProvider function. We also duplicate the small
// helper logic here for isolated unit checks.

// --- Inline copies of private helpers for direct testing ---

function resolveEnvVars(value: string): string {
    return value.replace(/\$\{env:([^}]+)\}/g, (_, varName) => {
        return process.env[varName] || '';
    });
}

function detectProviderType(model: string): 'anthropic' | 'openai-compat' {
    const modelLower = model.toLowerCase();
    if (modelLower.startsWith('claude-') || modelLower.includes('anthropic')) {
        return 'anthropic';
    }
    return 'openai-compat';
}

suite('Provider Factory — detectProviderType', () => {
    test('claude-sonnet-4-5 → anthropic', () => {
        assert.strictEqual(detectProviderType('claude-sonnet-4-5'), 'anthropic');
    });

    test('claude-3-haiku → anthropic', () => {
        assert.strictEqual(detectProviderType('claude-3-haiku'), 'anthropic');
    });

    test('claude-opus → anthropic', () => {
        assert.strictEqual(detectProviderType('claude-opus'), 'anthropic');
    });

    test('some-anthropic-model → anthropic (contains "anthropic")', () => {
        assert.strictEqual(detectProviderType('some-anthropic-model'), 'anthropic');
    });

    test('gpt-4o → openai-compat', () => {
        assert.strictEqual(detectProviderType('gpt-4o'), 'openai-compat');
    });

    test('gpt-4o-mini → openai-compat', () => {
        assert.strictEqual(detectProviderType('gpt-4o-mini'), 'openai-compat');
    });

    test('gemini-pro → openai-compat', () => {
        assert.strictEqual(detectProviderType('gemini-pro'), 'openai-compat');
    });

    test('llama-3-70b → openai-compat', () => {
        assert.strictEqual(detectProviderType('llama-3-70b'), 'openai-compat');
    });

    test('case insensitive — CLAUDE-SONNET → anthropic', () => {
        assert.strictEqual(detectProviderType('CLAUDE-SONNET'), 'anthropic');
    });
});

suite('Provider Factory — resolveEnvVars', () => {
    test('resolves ${env:VAR} from process.env', () => {
        const original = process.env['CORTEX_TEST_KEY'];
        process.env['CORTEX_TEST_KEY'] = 'secret123';
        try {
            assert.strictEqual(
                resolveEnvVars('Bearer ${env:CORTEX_TEST_KEY}'),
                'Bearer secret123'
            );
        } finally {
            if (original === undefined) delete process.env['CORTEX_TEST_KEY'];
            else process.env['CORTEX_TEST_KEY'] = original;
        }
    });

    test('resolves to empty string for undefined env var', () => {
        delete process.env['CORTEX_NONEXISTENT_VAR_XYZ'];
        assert.strictEqual(
            resolveEnvVars('key=${env:CORTEX_NONEXISTENT_VAR_XYZ}'),
            'key='
        );
    });

    test('resolves multiple env vars in one string', () => {
        process.env['CORTEX_A'] = 'aaa';
        process.env['CORTEX_B'] = 'bbb';
        try {
            assert.strictEqual(
                resolveEnvVars('${env:CORTEX_A}-${env:CORTEX_B}'),
                'aaa-bbb'
            );
        } finally {
            delete process.env['CORTEX_A'];
            delete process.env['CORTEX_B'];
        }
    });

    test('returns string unchanged if no placeholders', () => {
        assert.strictEqual(resolveEnvVars('sk-ant-plain-key'), 'sk-ant-plain-key');
    });
});

suite('Provider Factory — createProvider', () => {
    // We import the real createProvider to test validation logic.
    // The actual API calls won't be made; we just test that the provider
    // object is created correctly or errors are thrown.
    let createProvider: typeof import('../../providers/factory').createProvider;

    suiteSetup(() => {
        createProvider = require('../../providers/factory').createProvider;
    });

    test('throws when model is missing', () => {
        assert.throws(() => {
            createProvider({ model: '' } as any);
        }, /model/i);
    });

    test('throws when apiKey is missing', () => {
        assert.throws(() => {
            createProvider({ model: 'gpt-4o' } as any);
        }, /API key/i);
    });

    test('creates provider for OpenAI-compat model', () => {
        const provider = createProvider({
            model: 'gpt-4o',
            apiKey: 'sk-test-key',
            baseURL: 'https://api.openai.com',
        });

        assert.ok(provider);
        assert.ok(provider.name);
        assert.ok(typeof provider.stream === 'function');
    });

    test('creates provider for Anthropic model', () => {
        const provider = createProvider({
            model: 'claude-sonnet-4-5',
            apiKey: 'sk-ant-test',
            baseURL: 'https://api.anthropic.com',
        });

        assert.ok(provider);
        assert.ok(provider.name);
        assert.ok(typeof provider.stream === 'function');
    });

});

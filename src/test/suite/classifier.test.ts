// ============================================================================
// Classifier Unit Tests
// Tests the token estimation heuristic and AIClassifier JSON extraction logic.
// ============================================================================

import * as assert from 'assert';
import { LocalTokenCounter, AIClassifier } from '../../intelligence/classifier';
import { CortexProvider } from '../../core/types';

suite('AIClassifier', () => {
    let classifier: AIClassifier;

    // Mock provider that yields custom text
    const createMockProvider = (responseText: string, throwError: boolean = false): CortexProvider => {
        return {
            name: 'mock',
            maxContextWindow: 4000,
            supportsThinking: false,
            countTokens: (text: string) => Math.ceil(text.length / 3.5),
            stream: async function* (messages, systemPrompt, tools, signal, options) {
                if (throwError) throw new Error('Mock API Error');
                // Yield the custom text as chunks
                const chunkSize = 5;
                for (let i = 0; i < responseText.length; i += chunkSize) {
                    yield { type: 'content', text: responseText.slice(i, i + chunkSize) };
                }
            }
        };
    };

    setup(() => {
        classifier = new AIClassifier();
    });

    test('classifies correctly with direct JSON output (Layer 1)', async () => {
        const provider = createMockProvider('{"complexity":"simple","needsTools":false}');
        const result = await classifier.classify('hello', provider);
        assert.strictEqual(result.complexity, 'simple');
        assert.strictEqual(result.needsTools, false);
    });

    test('classifies correctly with markdown-wrapped JSON (Layer 2)', async () => {
        const provider = createMockProvider('```json\n{"complexity":"simple","needsTools":false}\n```');
        const result = await classifier.classify('what is rust', provider);
        assert.strictEqual(result.complexity, 'simple');
        assert.strictEqual(result.needsTools, false);
    });

    test('classifies correctly with prose surrounding JSON (Layer 3)', async () => {
        const text = 'Here is my analysis of your prompt.\nIt requires tools.\n{"complexity":"complex","needsTools":true}\nLet me know if you need more!';
        const provider = createMockProvider(text);
        const result = await classifier.classify('refactor the core logic', provider);
        assert.strictEqual(result.complexity, 'complex');
        assert.strictEqual(result.needsTools, true);
    });

    test('falls back to complex/needsTools on invalid JSON', async () => {
        const provider = createMockProvider('This is just plain text, no JSON anywhere.');
        const result = await classifier.classify('some prompt', provider);
        // Fallback default is complex/true
        assert.strictEqual(result.complexity, 'complex');
        assert.strictEqual(result.needsTools, true);
    });

    test('falls back to complex/needsTools on API error', async () => {
        const provider = createMockProvider('', true); // Throws error
        const result = await classifier.classify('some prompt', provider);
        assert.strictEqual(result.complexity, 'complex');
        assert.strictEqual(result.needsTools, true);
    });
});

suite('LocalTokenCounter', () => {
    let counter: LocalTokenCounter;

    setup(() => {
        counter = new LocalTokenCounter();
    });

    test('estimate() returns ceil(length / 3.2) for fresh counter', () => {
        const text = 'Hello, world!'; // 13 chars
        const expected = Math.ceil(13 / 3.2); // ceil(4.0625) = 5
        assert.strictEqual(counter.estimate(text), expected);
    });

    test('estimate() returns 0 for empty string', () => {
        assert.strictEqual(counter.estimate(''), 0);
    });

    test('estimate() scales linearly with text length', () => {
        const short = counter.estimate('abc'); // 3 chars
        const long = counter.estimate('abcdef'); // 6 chars
        // Long should be roughly 2x short
        assert.ok(long >= short);
        assert.ok(long <= short * 3);
    });

    test('calibrate() adjusts estimation factor', () => {
        const text = 'The quick brown fox jumps over the lazy dog.'; // 45 chars
        const beforeEstimate = counter.estimate(text);

        // Suppose actual API reports 20 tokens for this text
        counter.calibrate(text, 20);

        const afterEstimate = counter.estimate(text);

        // After calibration, estimate should shift closer to actual
        // The raw estimate was ceil(45/3.2) = 15, ratio = 20/15 = 1.33
        // So after calibration: ceil(15 * 1.33) ≈ 20
        assert.ok(afterEstimate !== beforeEstimate || beforeEstimate === 20);
    });

    test('calibrate() with multiple samples uses moving average', () => {
        const text = 'a'.repeat(32); // 32 chars, raw estimate = ceil(32/3.2) = 10

        // Calibrate with different actual token counts
        counter.calibrate(text, 10); // ratio 1.0
        counter.calibrate(text, 20); // ratio 2.0

        // Average ratio should be ~1.5
        const estimate = counter.estimate(text);
        // 10 * 1.5 = 15
        assert.strictEqual(estimate, 15);
    });

    test('calibrate() caps sliding window at 50 samples', () => {
        const text = 'a'.repeat(32); // raw estimate = 10

        // Push 60 samples with ratio 1.0
        for (let i = 0; i < 60; i++) {
            counter.calibrate(text, 10);
        }

        // Now push 50 samples with ratio 2.0
        for (let i = 0; i < 50; i++) {
            counter.calibrate(text, 20);
        }

        // All 50 samples should be ratio 2.0 now (old ones pushed out)
        const estimate = counter.estimate(text);
        assert.strictEqual(estimate, 20); // 10 * 2.0
    });

    test('calibrate() ignores zero values', () => {
        const text = 'hello';
        const before = counter.estimate(text);

        counter.calibrate(text, 0);
        counter.calibrate('', 10);

        const after = counter.estimate(text);
        assert.strictEqual(before, after);
    });

    test('estimate() with long text produces reasonable result', () => {
        const longText = 'x'.repeat(10000); // 10000 chars
        const estimate = counter.estimate(longText);
        // Should be roughly 10000 / 3.2 = 3125
        assert.ok(estimate >= 3000 && estimate <= 3500);
    });
});

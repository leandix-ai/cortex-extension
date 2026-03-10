import * as assert from 'assert';
import { SSELineBuffer, parseSSELine } from '../../core/sse-buffer';

suite('SSELineBuffer', () => {
    let buffer: SSELineBuffer;

    setup(() => {
        buffer = new SSELineBuffer();
    });

    test('push() handles complete lines', () => {
        const lines = buffer.push('data: {"test": 1}\n');
        assert.deepStrictEqual(lines, ['data: {"test": 1}']);
    });

    test('push() handles multiple complete lines', () => {
        const lines = buffer.push('data: {"a": 1}\ndata: {"b": 2}\n');
        assert.deepStrictEqual(lines, ['data: {"a": 1}', 'data: {"b": 2}']);
    });

    test('push() buffers partial lines', () => {
        const lines1 = buffer.push('data: {"test"');
        assert.deepStrictEqual(lines1, []); // No newline yet

        const lines2 = buffer.push(': 1}\n');
        assert.deepStrictEqual(lines2, ['data: {"test": 1}']);
    });

    test('push() handles mixed complete and partial lines', () => {
        const lines1 = buffer.push('data: 1\ndata: 2\ndata: 3');
        assert.deepStrictEqual(lines1, ['data: 1', 'data: 2']);

        const lines2 = buffer.push('\ndata: 4\n');
        assert.deepStrictEqual(lines2, ['data: 3', 'data: 4']);
    });

    test('flush() returns remaining data', () => {
        buffer.push('data: incomplete');
        const remaining = buffer.flush();
        assert.strictEqual(remaining, 'data: incomplete');
        assert.strictEqual(buffer.flush(), null); // Buffer is now empty
    });

    test('reset() clears the buffer', () => {
        buffer.push('data: incomplete');
        buffer.reset();
        assert.strictEqual(buffer.flush(), null);
    });

    test('push() ignores empty lines', () => {
        const lines = buffer.push('\n\ndata: 1\n\n\n');
        assert.deepStrictEqual(lines, ['data: 1']);
    });
});

suite('parseSSELine', () => {
    test('extracts data payload', () => {
        const payload = parseSSELine('data: {"value": 42}');
        assert.strictEqual(payload, '{"value": 42}');
    });

    test('returns null for [DONE] event', () => {
        const payload = parseSSELine('data: [DONE]');
        assert.strictEqual(payload, null);
    });

    test('returns null for non-data lines', () => {
        assert.strictEqual(parseSSELine(': comment'), null);
        assert.strictEqual(parseSSELine('event: ping'), null);
        assert.strictEqual(parseSSELine('id: 123'), null);
        assert.strictEqual(parseSSELine(''), null);
    });
});

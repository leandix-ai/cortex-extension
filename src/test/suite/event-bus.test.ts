// ============================================================================
// EventBus Unit Tests
// ============================================================================

import * as assert from 'assert';
import { EventBus } from '../../core/event-bus';

suite('EventBus', () => {
    let bus: EventBus;

    setup(() => {
        bus = new EventBus();
    });

    teardown(() => {
        bus.removeAll();
    });

    test('on() registers handler and emit() fires it with correct payload', () => {
        let received: any = null;
        bus.on('USER_PROMPT', (event) => {
            received = event;
        });

        bus.emit('USER_PROMPT', { prompt: 'hello' });

        assert.ok(received);
        assert.strictEqual((received.payload as any).prompt, 'hello');
        assert.strictEqual(received.type, 'USER_PROMPT');
        assert.ok(typeof received.timestamp === 'number');
    });

    test('on() supports multiple handlers for the same event', () => {
        let count = 0;
        bus.on('STREAM_START', () => { count++; });
        bus.on('STREAM_START', () => { count++; });

        bus.emit('STREAM_START', {});

        assert.strictEqual(count, 2);
    });

    test('unsubscribe function removes handler', () => {
        let count = 0;
        const unsub = bus.on('STREAM_END', () => { count++; });

        bus.emit('STREAM_END', {});
        assert.strictEqual(count, 1);

        unsub();
        bus.emit('STREAM_END', {});
        assert.strictEqual(count, 1); // Should not increase
    });

    test('once() fires handler only once', () => {
        let count = 0;
        bus.once('CANCEL_REQUEST', () => { count++; });

        bus.emit('CANCEL_REQUEST', {});
        bus.emit('CANCEL_REQUEST', {});

        assert.strictEqual(count, 1);
    });

    test('removeAll() with no args clears all handlers', () => {
        let count = 0;
        bus.on('STREAM_START', () => { count++; });
        bus.on('STREAM_END', () => { count++; });

        bus.removeAll();

        bus.emit('STREAM_START', {});
        bus.emit('STREAM_END', {});
        assert.strictEqual(count, 0);
    });

    test('removeAll(type) clears only handlers for that type', () => {
        let startCount = 0;
        let endCount = 0;
        bus.on('STREAM_START', () => { startCount++; });
        bus.on('STREAM_END', () => { endCount++; });

        bus.removeAll('STREAM_START');

        bus.emit('STREAM_START', {});
        bus.emit('STREAM_END', {});
        assert.strictEqual(startCount, 0);
        assert.strictEqual(endCount, 1);
    });

    test('emit() does not throw if no handlers registered', () => {
        assert.doesNotThrow(() => {
            bus.emit('CANCEL_REQUEST', {});
        });
    });

    test('sync handler error does not crash bus or prevent other handlers', () => {
        let secondCalled = false;
        bus.on('STREAM_ERROR', () => { throw new Error('test error'); });
        bus.on('STREAM_ERROR', () => { secondCalled = true; });

        assert.doesNotThrow(() => {
            bus.emit('STREAM_ERROR', { message: 'err' });
        });
        assert.ok(secondCalled);
    });

    test('async handler rejection does not crash bus', () => {
        bus.on('TOOL_REQUEST', async () => {
            throw new Error('async error');
        });

        assert.doesNotThrow(() => {
            bus.emit('TOOL_REQUEST', {});
        });
    });

    test('event timestamp is set automatically', () => {
        const before = Date.now();
        let ts = 0;
        bus.on('CONTEXT_READY', (event) => { ts = event.timestamp; });

        bus.emit('CONTEXT_READY', {});

        const after = Date.now();
        assert.ok(ts >= before && ts <= after);
    });
});

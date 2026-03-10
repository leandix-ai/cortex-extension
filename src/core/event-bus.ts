// ============================================================================
// Event Bus — Async Event-Driven Communication
// All inter-layer communication goes through here. No layer blocks another.
// ============================================================================

import { CortexEvent, CortexEventType } from './types';

type EventHandler<T = unknown> = (event: CortexEvent<T>) => void | Promise<void>;

export class EventBus {
  private handlers: Map<CortexEventType, Set<EventHandler>> = new Map();
  private debugMode = false;

  on<T = unknown>(type: CortexEventType, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    const typedHandler = handler as EventHandler;
    this.handlers.get(type)!.add(typedHandler);

    // Return unsubscribe function
    return () => {
      this.handlers.get(type)?.delete(typedHandler);
    };
  }

  emit<T = unknown>(type: CortexEventType, payload: T): void {
    const event: CortexEvent<T> = {
      type,
      payload,
      timestamp: Date.now(),
    };

    if (this.debugMode) {
      console.log(`[EventBus] ${type}`, payload);
    }

    const handlers = this.handlers.get(type);
    if (!handlers) return;

    for (const handler of handlers) {
      try {
        // Fire and forget — handlers must not block
        const result = handler(event);
        if (result instanceof Promise) {
          result.catch((err) => {
            console.error(`[EventBus] Handler error for ${type}:`, err);
          });
        }
      } catch (err) {
        console.error(`[EventBus] Sync handler error for ${type}:`, err);
      }
    }
  }

  once<T = unknown>(type: CortexEventType, handler: EventHandler<T>): () => void {
    const unsubscribe = this.on<T>(type, (event) => {
      unsubscribe();
      return handler(event);
    });
    return unsubscribe;
  }

  removeAll(type?: CortexEventType): void {
    if (type) {
      this.handlers.delete(type);
    } else {
      this.handlers.clear();
    }
  }

  setDebug(enabled: boolean): void {
    this.debugMode = enabled;
  }
}

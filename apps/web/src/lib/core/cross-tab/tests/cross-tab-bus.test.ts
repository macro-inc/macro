import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCrossTabBus } from '../cross-tab-bus';

class MockBroadcastChannel {
  static instance: MockBroadcastChannel | undefined;

  readonly postMessage = vi.fn();
  private messageHandler: ((event: { data: unknown }) => void) | undefined;

  constructor(readonly name: string) {
    MockBroadcastChannel.instance = this;
  }

  addEventListener(_type: string, handler: (event: { data: unknown }) => void) {
    this.messageHandler = handler;
  }

  emit(data: unknown) {
    this.messageHandler?.({ data });
  }
}

type TestMessage = { id: string; sentAt: number };

function parseTestMessage(value: unknown): TestMessage | null {
  if (typeof value !== 'object' || value === null) return null;
  const { id, sentAt } = value as { id?: unknown; sentAt?: unknown };
  return typeof id === 'string' && typeof sentAt === 'number'
    ? { id, sentAt }
    : null;
}

let busCount = 0;

/**
 * Each test gets its own channel/storage names: buses attach module-lifetime
 * listeners by design, so reusing names would leak deliveries across tests.
 */
function createTestBus(options?: {
  getMessageKey?: (message: TestMessage) => string;
}) {
  busCount += 1;
  const storageKey = `test.cross-tab-bus.${busCount}`;
  const bus = createCrossTabBus<TestMessage>({
    channelName: `test-cross-tab-bus-${busCount}`,
    storageKey,
    parse: parseTestMessage,
    getMessageKey: options?.getMessageKey,
  });
  return { bus, storageKey };
}

function dispatchStorageEvent(key: string, value: unknown) {
  window.dispatchEvent(
    new StorageEvent('storage', { key, newValue: JSON.stringify(value) })
  );
}

describe('createCrossTabBus', () => {
  beforeEach(() => {
    localStorage.clear();
    MockBroadcastChannel.instance = undefined;
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('publishes to this tab and both cross-tab transports', () => {
    const { bus, storageKey } = createTestBus();
    const handler = vi.fn();
    bus.subscribe(handler);

    const message = { id: 'a', sentAt: 1 };
    bus.publish(message);

    expect(handler).toHaveBeenCalledWith(message);
    expect(MockBroadcastChannel.instance?.postMessage).toHaveBeenCalledWith(
      message
    );
    expect(localStorage.getItem(storageKey)).toBe(JSON.stringify(message));
  });

  it('delivers messages arriving over BroadcastChannel', () => {
    const { bus } = createTestBus();
    const handler = vi.fn();
    bus.subscribe(handler);

    MockBroadcastChannel.instance?.emit({ id: 'a', sentAt: 1 });

    expect(handler).toHaveBeenCalledWith({ id: 'a', sentAt: 1 });
  });

  it('delivers messages arriving over the storage fallback, keyed', () => {
    const { bus, storageKey } = createTestBus();
    const handler = vi.fn();
    bus.subscribe(handler);

    dispatchStorageEvent(storageKey, { id: 'a', sentAt: 1 });
    dispatchStorageEvent('some-other-key', { id: 'b', sentAt: 2 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ id: 'a', sentAt: 1 });
  });

  it('handles a message delivered by both transports once when keyed', () => {
    const { bus, storageKey } = createTestBus({
      getMessageKey: (message) => message.id,
    });
    const handler = vi.fn();
    bus.subscribe(handler);

    MockBroadcastChannel.instance?.emit({ id: 'a', sentAt: 1 });
    dispatchStorageEvent(storageKey, { id: 'a', sentAt: 1 });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('re-delivers repeat messages when no message key is configured', () => {
    const { bus } = createTestBus();
    const handler = vi.fn();
    bus.subscribe(handler);

    MockBroadcastChannel.instance?.emit({ id: 'a', sentAt: 1 });
    MockBroadcastChannel.instance?.emit({ id: 'a', sentAt: 1 });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('drops payloads the parser rejects', () => {
    const { bus, storageKey } = createTestBus();
    const handler = vi.fn();
    bus.subscribe(handler);

    MockBroadcastChannel.instance?.emit({ unexpected: true });
    dispatchStorageEvent(storageKey, 'not-a-message');

    expect(handler).not.toHaveBeenCalled();
  });

  it('keeps delivering to other handlers when one throws', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const { bus } = createTestBus();
    const throwingHandler = vi.fn(() => {
      throw new Error('boom');
    });
    const handler = vi.fn();
    bus.subscribe(throwingHandler);
    bus.subscribe(handler);

    MockBroadcastChannel.instance?.emit({ id: 'a', sentAt: 1 });

    expect(handler).toHaveBeenCalledWith({ id: 'a', sentAt: 1 });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('stops delivering after unsubscribe', () => {
    const { bus } = createTestBus();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe(handler);

    unsubscribe();
    MockBroadcastChannel.instance?.emit({ id: 'a', sentAt: 1 });

    expect(handler).not.toHaveBeenCalled();
  });

  it('publishes via storage alone when BroadcastChannel is unavailable', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const { bus, storageKey } = createTestBus();
    const handler = vi.fn();
    bus.subscribe(handler);

    const message = { id: 'a', sentAt: 1 };
    bus.publish(message);

    expect(handler).toHaveBeenCalledWith(message);
    expect(localStorage.getItem(storageKey)).toBe(JSON.stringify(message));
  });

  it('still posts to BroadcastChannel when localStorage writes throw', () => {
    const { bus } = createTestBus();
    const handler = vi.fn();
    bus.subscribe(handler);
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('storage disabled');
      },
    });

    const message = { id: 'a', sentAt: 1 };
    expect(() => bus.publish(message)).not.toThrow();

    expect(handler).toHaveBeenCalledWith(message);
    expect(MockBroadcastChannel.instance?.postMessage).toHaveBeenCalledWith(
      message
    );
  });
});

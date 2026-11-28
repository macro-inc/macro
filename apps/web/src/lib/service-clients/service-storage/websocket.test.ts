import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The storage service, as seen by the app's websocket: refuses every
// connection while it is down and accepts it once it is back.
const server = vi.hoisted(() => ({ up: true, attempts: 0 }));

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = 0;
  binaryType: BinaryType = 'blob';
  bufferedAmount = 0;
  extensions = '';
  protocol = '';
  onclose = null;
  onerror = null;
  onmessage = null;
  onopen = null;

  constructor(readonly url: string) {
    super();
    server.attempts++;
    setTimeout(() => {
      if (server.up) {
        this.readyState = 1;
        this.dispatchEvent(new Event('open'));
        return;
      }

      this.readyState = 3;
      this.dispatchEvent(new Event('error'));
      this.dispatchEvent(new CloseEvent('close', { code: 1006 }));
    }, 0);
  }

  send() {}

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    setTimeout(
      () => this.dispatchEvent(new CloseEvent('close', { code: 1000 })),
      0
    );
  }
}

describe('storage websocket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    server.up = true;
    server.attempts = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reconnects when the API comes back after a long outage', async () => {
    const { storageWS } = await import('./websocket');
    storageWS.reconnect();
    await vi.advanceTimersByTimeAsync(100);
    expect(storageWS.readyState).toBe(WebSocket.OPEN);

    // The API goes away: the open socket drops and every reconnect is refused
    // for longer than a few retries' worth of time.
    server.up = false;
    storageWS.underlyingWebsocket?.close();
    await vi.advanceTimersByTimeAsync(150_000);
    expect(storageWS.readyState).not.toBe(WebSocket.OPEN);

    // Back on the same origin, with the device online and the window visible
    // the whole time, so no browser event kicks the socket.
    server.up = true;
    const attemptsBeforeRecovery = server.attempts;
    await vi.advanceTimersByTimeAsync(90_000);

    expect(server.attempts).toBeGreaterThan(attemptsBeforeRecovery);
    expect(storageWS.readyState).toBe(WebSocket.OPEN);

    storageWS.close();
    await vi.advanceTimersByTimeAsync(100);
  });
});

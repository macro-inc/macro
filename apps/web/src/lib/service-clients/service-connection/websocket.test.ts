import { WebsocketConnectionState } from '@macro-inc/collaboration/websocket';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ws } from './websocket';

vi.mock('./websocket-url', () => ({
  resolveWsUrl: async () => 'ws://gateway.test',
}));

const api = { online: true };
const sockets: FakeSocket[] = [];

/** Opens while the API is reachable; otherwise fails like a refused connection. */
class FakeSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  binaryType: BinaryType = 'blob';
  bufferedAmount = 0;
  extensions = '';
  protocol = '';
  readyState: number = FakeSocket.CONNECTING;
  onclose = null;
  onerror = null;
  onmessage = null;
  onopen = null;

  constructor(readonly url: string) {
    super();
    sockets.push(this);
    setTimeout(() => {
      if (api.online) {
        this.readyState = FakeSocket.OPEN;
        this.dispatchEvent(new Event('open'));
        return;
      }
      this.readyState = FakeSocket.CLOSED;
      this.dispatchEvent(new Event('error'));
      this.dispatchEvent(new CloseEvent('close', { code: 1006 }));
    }, 0);
  }

  send(data: string) {
    if (data === 'ping') {
      setTimeout(() => {
        this.dispatchEvent(new MessageEvent('message', { data: 'pong' }));
      }, 0);
    }
  }

  close() {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close', { code: 1000 }));
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
  api.online = true;
  sockets.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('reconnects when the API returns after an outage longer than two minutes', async () => {
  ws.reconnect();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(ws.connectionState).toBe(WebsocketConnectionState.Open);

  api.online = false;
  sockets.at(-1)?.close();
  await vi.advanceTimersByTimeAsync(150_000);
  expect(ws.connectionState).not.toBe(WebsocketConnectionState.Open);

  api.online = true;
  const attemptsBeforeRecovery = sockets.length;
  await vi.advanceTimersByTimeAsync(90_000);

  expect(sockets.length).toBeGreaterThan(attemptsBeforeRecovery);
  expect(ws.connectionState).toBe(WebsocketConnectionState.Open);
  ws.close();
});

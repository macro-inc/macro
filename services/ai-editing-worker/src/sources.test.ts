import type {
  FromRemote,
  IFromPeer,
} from '@macro-inc/collaboration/sync-service/generated/schema';
import type { SyncSocket } from '@macro-inc/collaboration/sync-service/socket';
import {
  WebsocketConnectionState,
  WebsocketEvent,
  type WebsocketEventListener,
} from '@macro-inc/collaboration/websocket';
import type { Span } from '@macro-inc/observability';
import { describe, expect, it, vi } from 'vitest';
import { InitialSyncDiagnostics } from './sources';

type Listener = WebsocketEventListener<WebsocketEvent, IFromPeer, FromRemote>;

class FakeSocket implements SyncSocket {
  connectionState = WebsocketConnectionState.Connecting;
  private readonly listeners = new Map<WebsocketEvent, Set<Listener>>();

  send(): boolean {
    return true;
  }
  startHeartbeat(): void {}
  reconnectIfDisconnected(): void {}
  close(): void {}

  addEventListener<K extends WebsocketEvent>(
    type: K,
    listener: WebsocketEventListener<K, IFromPeer, FromRemote>
  ): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener as Listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener<K extends WebsocketEvent>(
    type: K,
    listener: WebsocketEventListener<K, IFromPeer, FromRemote>
  ): void {
    this.listeners.get(type)?.delete(listener as Listener);
  }

  fire(type: WebsocketEvent, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(this as never, event as never);
    }
  }
}

describe('InitialSyncDiagnostics', () => {
  it('records lifecycle state without URL, token, or close reason', () => {
    const socket = new FakeSocket();
    const pseudonymousUserId = `ai-edit:${'a'.repeat(64)}`;
    const diagnostics = new InitialSyncDiagnostics(socket, pseudonymousUserId);
    const setAttr = vi.fn();
    const event = vi.fn();
    const span = { setAttr, event } as unknown as Span;

    // URL resolution and open commonly happen before edit.sync_init starts.
    socket.fire(WebsocketEvent.UrlResolved, {
      detail: { url: 'wss://sync.example/connect?token=secret' },
    });
    socket.connectionState = WebsocketConnectionState.Open;
    socket.fire(WebsocketEvent.Open, {});
    diagnostics.attach(span);

    expect(setAttr).toHaveBeenCalledWith('usr.id', pseudonymousUserId);
    expect(setAttr).toHaveBeenCalledWith('ws.state', 'open');
    expect(event).toHaveBeenCalledWith('websocket.constructed', undefined);
    expect(event).toHaveBeenCalledWith('websocket.url_resolved', undefined);
    expect(event).toHaveBeenCalledWith('websocket.open', undefined);

    socket.fire(WebsocketEvent.Error, {});
    socket.connectionState = WebsocketConnectionState.Reconnecting;
    socket.fire(WebsocketEvent.retry, {
      detail: {
        retries: 2,
        backoff: 1_000,
        url: 'wss://sync.example/connect?token=secret',
      },
    });
    socket.fire(WebsocketEvent.Close, {
      code: 1006,
      wasClean: false,
      reason: 'token=secret',
    });

    expect(setAttr).toHaveBeenCalledWith('ws.url_resolved', true);
    expect(setAttr).toHaveBeenCalledWith('ws.opened', true);
    expect(setAttr).toHaveBeenCalledWith('ws.error_count', 1);
    expect(setAttr).toHaveBeenCalledWith('ws.retry_count', 1);
    expect(setAttr).toHaveBeenCalledWith('ws.close_count', 1);
    expect(setAttr).toHaveBeenCalledWith('ws.state', 'open');
    expect(setAttr).toHaveBeenCalledWith('ws.state', 'reconnecting');
    expect(setAttr).toHaveBeenCalledWith('ws.state', 'closed');
    expect(event).toHaveBeenCalledWith('websocket.error', {
      'ws.state': 'open',
    });
    expect(event).toHaveBeenCalledWith('websocket.retry', {
      'ws.retry.attempt': 2,
      'ws.retry.backoff_ms': 1_000,
    });
    expect(event).toHaveBeenCalledWith('websocket.close', {
      'ws.close.code': 1006,
      'ws.close.clean': false,
    });
    expect(JSON.stringify(event.mock.calls)).not.toContain('secret');

    const attributeCalls = setAttr.mock.calls.length;
    diagnostics.finish();
    socket.fire(WebsocketEvent.Error, {});
    expect(setAttr).toHaveBeenCalledTimes(attributeCalls);
  });
});

/**
 * Glue for headless callers (the AI editing worker): builds the shared
 * `SyncServiceSource` over a static-URL socket, plus a minimal `Awareness` for
 * AI peer attribution. The wire protocol itself lives in `service-sync` and is
 * shared with the browser — nothing is reimplemented here.
 */

import type { Awareness } from '@macro-inc/collaboration/collab/awareness';
import type { SyncSocket } from '@macro-inc/collaboration/sync-service/socket';
import { createSyncSocket } from '@macro-inc/collaboration/sync-service/socket';
import { SyncServiceSource } from '@macro-inc/collaboration/sync-service/source';
import {
  WebsocketConnectionState,
  WebsocketEvent,
} from '@macro-inc/collaboration/websocket';
import type { Span } from '@macro-inc/observability';
import { EphemeralStore, type PeerID } from 'loro-crdt';

type DiagnosticEvent = {
  name: string;
  attributes?: Record<string, boolean | number | string>;
};

function socketState(state: WebsocketConnectionState): string {
  switch (state) {
    case WebsocketConnectionState.Connecting:
      return 'connecting';
    case WebsocketConnectionState.Open:
      return 'open';
    case WebsocketConnectionState.Closing:
      return 'closing';
    case WebsocketConnectionState.Closed:
      return 'closed';
    case WebsocketConnectionState.Reconnecting:
      return 'reconnecting';
  }
}

/** Buffers safe WebSocket lifecycle events until the initial-sync span starts. */
export class InitialSyncDiagnostics {
  private span: Span | undefined;
  private pending: DiagnosticEvent[] = [];
  private retries = 0;
  private closes = 0;
  private errors = 0;
  private urlResolved = false;
  private opened = false;

  private readonly onUrlResolved = () => {
    this.urlResolved = true;
    this.record('websocket.url_resolved');
    this.span?.setAttr('ws.url_resolved', true);
  };
  private readonly onOpen = () => {
    this.opened = true;
    this.record('websocket.open');
    this.span?.setAttr('ws.opened', true);
    this.span?.setAttr('ws.state', 'open');
  };
  private readonly onClose = (_ws: unknown, event: CloseEvent) => {
    this.closes++;
    this.record('websocket.close', {
      'ws.close.code': event.code,
      'ws.close.clean': event.wasClean,
    });
    this.span?.setAttr('ws.close_count', this.closes);
    this.span?.setAttr('ws.state', 'closed');
  };
  private readonly onError = () => {
    this.errors++;
    this.record('websocket.error', {
      'ws.state': socketState(this.ws.connectionState),
    });
    this.span?.setAttr('ws.error_count', this.errors);
  };
  private readonly onRetry = (
    _ws: unknown,
    event: CustomEvent<{ retries: number; backoff: number }>
  ) => {
    this.retries++;
    this.record('websocket.retry', {
      'ws.retry.attempt': event.detail.retries,
      'ws.retry.backoff_ms': event.detail.backoff,
    });
    this.span?.setAttr('ws.retry_count', this.retries);
    this.span?.setAttr('ws.state', 'reconnecting');
  };

  public constructor(
    private readonly ws: SyncSocket,
    private readonly pseudonymousUserId?: string
  ) {
    this.record('websocket.constructed');
    ws.addEventListener(WebsocketEvent.UrlResolved, this.onUrlResolved);
    ws.addEventListener(WebsocketEvent.Open, this.onOpen);
    ws.addEventListener(WebsocketEvent.Close, this.onClose);
    ws.addEventListener(WebsocketEvent.Error, this.onError);
    ws.addEventListener(WebsocketEvent.retry, this.onRetry);
  }

  /** Attach the initial-sync span and replay lifecycle events already observed. */
  public attach(span: Span): void {
    this.span = span;
    if (this.pseudonymousUserId !== undefined) {
      span.setAttr('usr.id', this.pseudonymousUserId);
    }
    span.setAttr('ws.constructed', true);
    span.setAttr('ws.state', socketState(this.ws.connectionState));
    span.setAttr('ws.url_resolved', this.urlResolved);
    span.setAttr('ws.opened', this.opened);
    span.setAttr('ws.close_count', this.closes);
    span.setAttr('ws.error_count', this.errors);
    span.setAttr('ws.retry_count', this.retries);
    for (const event of this.pending) span.event(event.name, event.attributes);
    this.pending = [];
  }

  /** Stop observing once initial sync has completed or failed. */
  public finish(): void {
    this.ws.removeEventListener(WebsocketEvent.UrlResolved, this.onUrlResolved);
    this.ws.removeEventListener(WebsocketEvent.Open, this.onOpen);
    this.ws.removeEventListener(WebsocketEvent.Close, this.onClose);
    this.ws.removeEventListener(WebsocketEvent.Error, this.onError);
    this.ws.removeEventListener(WebsocketEvent.retry, this.onRetry);
    this.span = undefined;
    this.pending = [];
  }

  private record(
    name: string,
    attributes?: DiagnosticEvent['attributes']
  ): void {
    if (this.span) this.span.event(name, attributes);
    else this.pending.push({ name, attributes });
  }
}

/**
 * A {@link SyncServiceSource} bound to a fixed, token-bearing URL. A worker
 * request is short-lived and online for its whole life, so every (re)connect
 * resolves to the same URL. Closes the socket on `signal` abort.
 */
export function createWorkerSyncSource(
  wsUrl: string,
  documentId: string,
  signal?: AbortSignal,
  pseudonymousUserId?: string
): { source: SyncServiceSource; diagnostics: InitialSyncDiagnostics } {
  const ws = createSyncSocket(() => wsUrl);
  const diagnostics = new InitialSyncDiagnostics(ws, pseudonymousUserId);
  const source = new SyncServiceSource(ws, documentId);
  signal?.addEventListener('abort', () => source.cleanup());
  return { source, diagnostics };
}

export function createWorkerAwareness(peerId: PeerID): Awareness<unknown> {
  const store = new EphemeralStore(30_000);
  return {
    local: () => ({
      user: { userId: undefined, color: '', peerId },
      selection: undefined,
    }),
    remote: () => [],
    updateLocalAwareness: (selection) => {
      if (selection === undefined) store.delete(peerId);
      else store.set(peerId, selection as never);
    },
    updateRemoteAwareness: () => {},
    importRemoteAwareness: (update) => {
      try {
        store.apply(update);
      } catch {
        /* drop malformed awareness */
      }
    },
    getEncodedLocalAwareness: () => store.encodeAll(),
  };
}

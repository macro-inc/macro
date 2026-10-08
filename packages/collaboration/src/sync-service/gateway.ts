import { match } from 'ts-pattern';
import {
  ArrayQueue,
  BebopSerializer,
  ExponentialBackoff,
  type UrlResolver,
  type Websocket,
  WebsocketBuilder,
  WebsocketConnectionState,
  WebsocketEvent,
  type WebsocketEventListener,
} from '../websocket';
import { intoFrames, Reassembler } from '../websocket/platform/framing';
import {
  FromPeer,
  FromRemote,
  FromRouter,
  type IFromPeer,
  type IToRouter,
  ToRouter,
} from './generated/schema';
import type { SyncSocket } from './socket';

/**
 * Multiplexes many documents' sync traffic over ONE websocket to the
 * connection gateway, instead of one direct sync-service socket per document.
 *
 * Wire shape: every frame is a Bebop `ToRouter`/`FromRouter` envelope naming
 * the document; the inner payloads are the same `FromPeer`/`FromRemote`
 * messages the direct socket speaks, unchanged. Server side, the
 * connection-gateway fans inbound frames out to the sync-router, which holds
 * one upstream connection per (socket, document).
 *
 * Each document gets a {@link SyncSocket}-compatible virtual socket, so
 * `SyncServiceSource` works unmodified on top of this transport.
 */
export class GatewaySyncTransport {
  private readonly getUrl: UrlResolver;
  private ws: Websocket<IToRouter, FromRouter> | undefined;
  private readonly docs = new Map<string, VirtualSyncSocket>();
  private heartbeatStarted = false;

  public constructor(getUrl: UrlResolver) {
    this.getUrl = getUrl;
  }

  /**
   * Attach a document to the shared socket: subscribes immediately and
   * returns the virtual socket for it. `refreshToken` is consulted on every
   * re-subscribe (upstream drop, gateway reconnect), mirroring how the direct
   * socket refetches a permission token per reconnect.
   */
  public attach(
    documentId: string,
    initialToken: string | undefined,
    refreshToken: () => Promise<string>
  ): SyncSocket {
    const existing = this.docs.get(documentId);
    if (existing) return existing;

    const virtual = new VirtualSyncSocket(
      this,
      documentId,
      initialToken,
      refreshToken
    );
    this.docs.set(documentId, virtual);
    virtual.subscribe();
    return virtual;
  }

  /** Called by a virtual socket when it is closed for good. */
  public detach(documentId: string): void {
    this.docs.delete(documentId);
  }

  /** The shared gateway websocket, built lazily on first use. */
  public socket(): Websocket<IToRouter, FromRouter> {
    if (this.ws) return this.ws;
    const ws = new WebsocketBuilder<IToRouter, FromRouter>(this.getUrl)
      .withSerializer(new BebopSerializer(ToRouter, FromRouter))
      .withBackoff(new ExponentialBackoff(250, 5))
      .withMaxRetries(20)
      // Document frames are held by each virtual socket until the router
      // acknowledges its fresh subscription.
      .withBuffer(new ArrayQueue())
      .withHeartbeat({
        interval: 10_000,
        timeout: 5_000,
        pingMessage: 'ping',
        pongMessage: 'pong',
        maxMissedHeartbeats: 2,
        autoStart: false,
      })
      .build();

    ws.addEventListener(WebsocketEvent.Message, (_ws, event) => {
      this.route(event.data);
    });
    ws.addEventListener(WebsocketEvent.Reconnect, () => {
      // A new gateway socket is a new fanout connection server-side: every
      // route was torn down, so every document must re-subscribe.
      for (const virtual of this.docs.values()) virtual.resubscribe();
    });
    ws.addEventListener(WebsocketEvent.Close, (_ws, event) => {
      for (const virtual of this.docs.values()) virtual.onGatewayClose(event);
    });
    ws.addEventListener(WebsocketEvent.HeartbeatMissed, (_ws, event) => {
      for (const virtual of this.docs.values()) {
        virtual.onGatewayHeartbeatMissed(event);
      }
    });

    this.ws = ws;
    return ws;
  }

  /** Start the shared heartbeat once any document finishes its initial sync. */
  public startHeartbeat(): void {
    if (this.heartbeatStarted) return;
    this.heartbeatStarted = true;
    this.socket().startHeartbeat();
  }

  private route(message: FromRouter): void {
    const documentId = message.value.docId;
    const virtual = this.docs.get(documentId);
    if (!virtual) return;
    if (message.isRouterSubscribed()) {
      virtual.onSubscribed();
    } else if (message.isRouterDocFrame()) {
      virtual.onDocFrame(message.value.payload);
    } else if (message.isRouterSubscribeFailed()) {
      virtual.onDocClosed(4401, message.value.reason);
    } else if (message.isRouterDocClosed()) {
      virtual.onDocClosed(4000, message.value.reason);
    }
  }
}

type ListenerSets = {
  [K in WebsocketEvent]?: Set<WebsocketEventListener<K, IFromPeer, FromRemote>>;
};

/** Backoff for per-document re-subscribes after an upstream drop. */
const RESUBSCRIBE_BASE_MS = 500;
const RESUBSCRIBE_MAX_MS = 8_000;

/**
 * A {@link SyncSocket} for one document, riding the shared gateway socket.
 *
 * Lifecycle mapping (virtual event ← gateway/envelope cause):
 * - Open       ← first `RouterSubscribed`
 * - Message    ← `RouterDocFrame` (decoded to `FromRemote`)
 * - Close      ← `RouterSubscribeFailed` / `RouterDocClosed` / gateway close
 * - Reconnect  ← any later `RouterSubscribed` (upstream or gateway recovery)
 */
class VirtualSyncSocket implements SyncSocket {
  private readonly transport: GatewaySyncTransport;
  private readonly documentId: string;
  private readonly refreshToken: () => Promise<string>;
  private initialToken: string | undefined;
  private reassembler = new Reassembler();
  private subscriptionAttempt = 0;

  private readonly listeners: ListenerSets = {};
  private state: 'subscribing' | 'open' | 'dropped' | 'closed' = 'subscribing';
  private wasEverOpen = false;
  private resubscribeTimer: ReturnType<typeof setTimeout> | undefined;
  private resubscribeDelay = RESUBSCRIBE_BASE_MS;
  /** Frames sent while dropped, flushed after the next Subscribe. */
  private pending: IFromPeer[] = [];

  public constructor(
    transport: GatewaySyncTransport,
    documentId: string,
    initialToken: string | undefined,
    refreshToken: () => Promise<string>
  ) {
    this.transport = transport;
    this.documentId = documentId;
    this.initialToken = initialToken;
    this.refreshToken = refreshToken;
  }

  public get connectionState(): WebsocketConnectionState {
    const gateway = this.transport.socket().connectionState;
    if (gateway !== WebsocketConnectionState.Open) return gateway;
    return match(this.state)
      .with('open', () => WebsocketConnectionState.Open)
      .with('subscribing', () => WebsocketConnectionState.Connecting)
      .with('dropped', () => WebsocketConnectionState.Reconnecting)
      .with('closed', () => WebsocketConnectionState.Closed)
      .exhaustive();
  }

  public send(message: IFromPeer): boolean {
    if (this.state === 'closed') return false;
    if (this.state !== 'open') {
      // Hold edits until fresh authorization and the downstream handshake
      // complete. This also prevents stale frames overtaking a resubscribe.
      this.pending.push(message);
      return true;
    }
    return this.sendFrame(message);
  }

  public startHeartbeat(): void {
    this.transport.startHeartbeat();
  }

  public reconnectIfDisconnected(): void {
    this.transport.socket().reconnectIfDisconnected();
    if (this.state === 'dropped') this.resubscribe();
  }

  public close(): void {
    if (this.state === 'closed') return;
    this.clearResubscribeTimer();
    if (
      this.state !== 'dropped' &&
      this.transport.socket().connectionState === WebsocketConnectionState.Open
    ) {
      this.transport
        .socket()
        .send(ToRouter.fromRouterUnsubscribe({ docId: this.documentId }));
    }
    this.state = 'closed';
    this.subscriptionAttempt++;
    this.pending = [];
    this.transport.detach(this.documentId);
  }

  public addEventListener<K extends WebsocketEvent>(
    type: K,
    listener: WebsocketEventListener<K, IFromPeer, FromRemote>
  ): void {
    // The per-key generic can't be proven against the mapped type; the
    // add/dispatch pair keeps K consistent.
    let listeners = this.listeners[type] as unknown as
      | Set<WebsocketEventListener<K, IFromPeer, FromRemote>>
      | undefined;
    if (!listeners) {
      listeners = new Set();
      (this.listeners as Record<K, unknown>)[type] = listeners;
    }
    listeners.add(listener);
  }

  public removeEventListener<K extends WebsocketEvent>(
    type: K,
    listener: WebsocketEventListener<K, IFromPeer, FromRemote>
  ): void {
    (
      this.listeners[type] as unknown as
        | Set<WebsocketEventListener<K, IFromPeer, FromRemote>>
        | undefined
    )?.delete(listener);
  }

  /** Send `RouterSubscribe`, minting a fresh token when the initial is spent. */
  public subscribe(): void {
    if (this.state === 'closed') return;
    const attempt = ++this.subscriptionAttempt;
    this.state = 'subscribing';
    void this.authorizeSubscription(attempt);
  }

  private async authorizeSubscription(attempt: number): Promise<void> {
    const initial = this.initialToken;
    this.initialToken = undefined;
    try {
      const token = initial ?? (await this.refreshToken());
      if (this.state === 'closed' || attempt !== this.subscriptionAttempt)
        return;
      this.transport
        .socket()
        .send(ToRouter.fromRouterSubscribe({ docId: this.documentId, token }));
    } catch {
      if (this.state === 'closed' || attempt !== this.subscriptionAttempt)
        return;
      this.state = 'dropped';
      this.scheduleResubscribe();
    }
  }

  public resubscribe(): void {
    this.clearResubscribeTimer();
    this.subscribe();
  }

  public onSubscribed(): void {
    const reconnected = this.wasEverOpen;
    this.state = 'open';
    this.reassembler = new Reassembler();
    const pending = this.pending.splice(0);
    for (const message of pending) this.sendFrame(message);
    this.wasEverOpen = true;
    this.resubscribeDelay = RESUBSCRIBE_BASE_MS;
    // Mirror the concrete Websocket's ordering: Reconnect (when applicable)
    // and then Open, so state signals settle on Open.
    if (reconnected) {
      this.dispatch(
        WebsocketEvent.Reconnect,
        new CustomEvent(WebsocketEvent.Reconnect, {
          detail: { retries: 0, lastConnection: undefined, url: 'gateway' },
        })
      );
    }
    this.dispatch(WebsocketEvent.Open, new Event(WebsocketEvent.Open));
  }

  public onDocFrame(payload: Uint8Array): void {
    const complete = this.reassembler.push(payload);
    if (!complete) return;
    const message = FromRemote.decode(complete);
    this.dispatch(
      WebsocketEvent.Message,
      new MessageEvent(WebsocketEvent.Message, { data: message })
    );
  }

  public onDocClosed(code: number, reason: string): void {
    if (this.state === 'closed') return;
    this.state = 'dropped';
    this.subscriptionAttempt++;
    this.reassembler = new Reassembler();
    this.dispatch(
      WebsocketEvent.Close,
      new CloseEvent(WebsocketEvent.Close, { code, reason, wasClean: false })
    );
    this.scheduleResubscribe();
  }

  public onGatewayClose(event: CloseEvent): void {
    if (this.state === 'closed') return;
    // The gateway socket owns reconnection; we just report the drop and wait
    // for the transport's Reconnect handler to re-subscribe us.
    this.clearResubscribeTimer();
    this.state = 'dropped';
    this.subscriptionAttempt++;
    this.reassembler = new Reassembler();
    this.dispatch(WebsocketEvent.Close, event);
  }

  public onGatewayHeartbeatMissed(
    event: CustomEvent<{ missedHeartbeats: number; willReconnect: boolean }>
  ): void {
    this.dispatch(
      WebsocketEvent.HeartbeatMissed,
      event as Parameters<
        WebsocketEventListener<
          WebsocketEvent.HeartbeatMissed,
          IFromPeer,
          FromRemote
        >
      >[1]
    );
  }

  private sendFrame(message: IFromPeer): boolean {
    for (const payload of intoFrames(FromPeer.encode(message))) {
      if (
        !this.transport
          .socket()
          .send(ToRouter.fromRouterFrame({ docId: this.documentId, payload }))
      )
        return false;
    }
    return true;
  }

  private scheduleResubscribe(): void {
    if (this.state === 'closed' || this.resubscribeTimer) return;
    const delay = this.resubscribeDelay;
    this.resubscribeDelay = Math.min(delay * 2, RESUBSCRIBE_MAX_MS);
    this.resubscribeTimer = setTimeout(() => {
      this.resubscribeTimer = undefined;
      if (this.state === 'dropped') this.subscribe();
    }, delay);
  }

  private clearResubscribeTimer(): void {
    if (this.resubscribeTimer) {
      clearTimeout(this.resubscribeTimer);
      this.resubscribeTimer = undefined;
    }
  }

  private dispatch<K extends WebsocketEvent>(
    type: K,
    event: Parameters<WebsocketEventListener<K, IFromPeer, FromRemote>>[1]
  ): void {
    const listeners = this.listeners[type] as unknown as
      | Set<WebsocketEventListener<K, IFromPeer, FromRemote>>
      | undefined;
    if (!listeners) return;
    // The listener signature carries the concrete Websocket for convenience;
    // sources only use the event, so the virtual socket passes itself.
    const instance = this as unknown as Websocket<IFromPeer, FromRemote>;
    for (const listener of [...listeners]) listener(instance, event);
  }
}

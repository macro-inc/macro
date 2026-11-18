import { platformWebSocketFactory } from '../websocket/platform/factory';
import type {
  MinimalWebSocket,
  WebSocketFactory,
} from '../websocket/platform/minimal-websocket';
import { RouteMsg, TelemetryMsg } from './abi.generated';
import type { SessionAuthorization } from './executor';
import { decodeOutput, Flag } from './output';
import type { SessionTelemetry } from './telemetry';
import type { SyncRouter } from './wasm.generated';

/** Shared physical I/O only; native RouterCore owns route state and token generations. */
export class SessionRouter {
  private readonly native: SyncRouter;
  private readonly sockets = new Map<number, MinimalWebSocket>();
  private readonly routes = new Map<string, Set<(event: Uint8Array) => void>>();
  private readonly queue: (() => number)[] = [];
  private active = false;
  private closed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly origin = performance.now();
  constructor(
    create: (now: number, wall: number) => SyncRouter,
    private readonly auth: SessionAuthorization,
    private readonly url: (traceparent: string) => string,
    private readonly telemetry: SessionTelemetry,
    private readonly factory: WebSocketFactory = platformWebSocketFactory
  ) {
    this.native = create(this.now(), Date.now());
  }
  private now = () => performance.now() - this.origin;
  attach(
    doc: string,
    callback: (event: Uint8Array) => void,
    token?: string
  ): () => void {
    let routes = this.routes.get(doc);
    if (!routes) {
      routes = new Set();
      this.routes.set(doc, routes);
    }
    routes.add(callback);
    this.run(() => this.native.attach(doc, token));
    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      const routes = this.routes.get(doc);
      routes?.delete(callback);
      if (routes?.size === 0) this.routes.delete(doc);
      this.run(() => this.native.detach(doc));
    };
  }
  send(doc: string, frame: Uint8Array): void {
    this.run(() => this.native.send(doc, frame, this.now(), Date.now()));
  }
  reconnect(doc: string): void {
    this.run(() => this.native.reconnect(doc, this.now(), Date.now()));
  }
  host(signal: number): void {
    this.run(() => this.native.host(signal, this.now(), Date.now()));
  }
  async visible(): Promise<void> {
    for (const socket of this.sockets.values()) {
      if ('recover' in socket && typeof socket.recover === 'function')
        await socket.recover();
    }
    this.host(1);
  }
  private run(call: () => number): void {
    if (this.closed) return;
    this.queue.push(call);
    if (this.active) return;
    this.active = true;
    try {
      while (this.queue.length) {
        const next = this.queue.shift();
        if (next) this.consume(next());
      }
    } finally {
      this.active = false;
    }
  }
  private consume(flags: number): void {
    if (flags & Flag.WakeChanged) {
      clearTimeout(this.timer);
      const at = this.native.wakeAt();
      if (at >= 0)
        this.timer = setTimeout(
          () => this.run(() => this.native.tick(this.now(), Date.now())),
          Math.max(0, at - this.now())
        );
    }
    if (!(flags & (Flag.Io | Flag.View | Flag.Error))) return;
    for (const effect of decodeOutput(this.native.takeOutput()).effects) {
      if (effect.tag === 1) {
        const doc = new TextDecoder().decode(effect.payload);
        this.fetch(doc, effect.a);
      } else if (effect.tag === 11) {
        const socket = this.factory(
          this.url(new TextDecoder().decode(effect.payload))
        );
        socket.binaryType = 'arraybuffer';
        this.sockets.set(effect.a, socket);
        socket.onopen = () =>
          this.run(() =>
            this.native.socketOpened(effect.a, this.now(), Date.now())
          );
        socket.onmessage = (event) => {
          if (typeof event.data === 'string')
            this.run(() =>
              this.native.socketText(
                effect.a,
                event.data,
                this.now(),
                Date.now()
              )
            );
          else if (event.data instanceof ArrayBuffer)
            this.run(() =>
              this.native.socketFrame(
                effect.a,
                new Uint8Array(event.data),
                this.now(),
                Date.now()
              )
            );
        };
        socket.onclose = (event) => {
          this.sockets.delete(effect.a);
          this.run(() =>
            this.native.socketClosed(
              effect.a,
              event.code,
              event.wasClean,
              this.now(),
              Date.now()
            )
          );
        };
        socket.onerror = () =>
          this.run(() =>
            this.native.socketClosed(
              effect.a,
              1006,
              false,
              this.now(),
              Date.now()
            )
          );
      } else if (effect.tag === 3)
        this.sockets.get(effect.a)?.send(effect.payload);
      else if (effect.tag === 4) this.sockets.get(effect.a)?.send('ping');
      else if (effect.tag === 5) {
        const socket = this.sockets.get(effect.a);
        if (socket) {
          if (socket.readyState === socket.CONNECTING)
            socket.addEventListener('open', () => socket.close(effect.b), {
              once: true,
            });
          else socket.close(effect.b);
        }
      } else if (effect.tag === 8)
        this.telemetry.forward(TelemetryMsg.decode(effect.payload));
      else if (effect.tag === 12) {
        const route = RouteMsg.decode(effect.payload);
        for (const callback of this.routes.get(route.doc) ?? [])
          callback(effect.payload);
      } else throw new Error(`Unexpected router effect ${effect.tag}`);
    }
  }
  private fetch(doc: string, attempt: number): void {
    const task = this.auth.token(doc).then(
      (result) =>
        this.run(() =>
          this.native.tokenFetched(
            doc,
            attempt,
            result.token,
            result.access,
            this.now(),
            Date.now()
          )
        ),
      () =>
        this.run(() =>
          this.native.tokenFetched(
            doc,
            attempt,
            undefined,
            0,
            this.now(),
            Date.now()
          )
        )
    );
    task.catch((error) => {
      this.telemetry.forward({
        span: 0n,
        parent: 0n,
        kind: 1,
        name: 'router.executor.error',
        outcome: '',
        error: true,
        attrs: [],
      });
      console.error('Router completion failed', error);
    });
  }
  /** Free only after all attached session owners have stopped. */
  free(): void {
    if (this.closed) return;
    if (this.routes.size) throw new Error('Router still has session owners');
    this.closed = true;
    clearTimeout(this.timer);
    for (const socket of this.sockets.values()) socket.close();
    this.sockets.clear();
    this.native.free();
  }
}

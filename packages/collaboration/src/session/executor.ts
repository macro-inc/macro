import { Telemetry } from '@macro-inc/observability';
import { platformWebSocketFactory } from '../websocket/platform/factory';
import type {
  MinimalWebSocket,
  WebSocketFactory,
} from '../websocket/platform/minimal-websocket';
import {
  ClosedReason,
  ConnectMsg,
  Failure,
  type IViewEffectMsg,
  SaveReason,
  SessionInputMsg,
  StorageOpMsg,
  TelemetryMsg,
} from './abi.generated';
import { emptyInput } from './input';
import { SessionLease } from './lease';
import { decodeOutput, type Effect, Flag } from './output';
import type { SessionRouter } from './router';
import { StorageAdapter, type StorageResult } from './storage';
import type { SessionTelemetry } from './telemetry';
import type { DocSession, EditorSession } from './wasm.generated';

export type NativeSession = EditorSession | DocSession;
export interface SessionAuthorization {
  token(doc: string): Promise<{ token: string; access: number }>;
  subscribe(
    callback: (current: boolean, canWrite: boolean, canComment: boolean) => void
  ): () => void;
}
export interface ViewApplier {
  apply(
    words: Uint32Array,
    strings: Uint8Array,
    effects: IViewEffectMsg[]
  ): void;
}
/** Presence distinguishes an aborted call from a successful call, including throw undefined. */
export interface ExecutorFailure {
  readonly error: unknown;
}
export interface ExecutorOptions<S extends NativeSession> {
  doc: string;
  owner: string;
  user: string;
  create: (now: number, wall: number) => S;
  /** Release typed host ownership before native free if executor construction fails. */
  onConstructionFailure?: (session: S) => void;
  /** Inspect issued callback metadata after a native call and before output transfer. */
  beforeConsume?: (flags: number) => void;
  /** Complete invocation cleanup after the outer FIFO exits and synchronous admission unlocks. */
  afterDrain?: (failure?: ExecutorFailure) => void;
  view: ViewApplier;
  auth: SessionAuthorization;
  /** Supplied by the application's servers.ts; the package never invents hosts. */
  socketUrl: (doc: string, token: string, traceparent: string) => string;
  telemetry: SessionTelemetry;
  /** Observe native connection/save status without changing session policy. */
  onStatus?: (status: IViewEffectMsg) => void;
  storage?: StorageAdapter;
  router?: SessionRouter;
  sockets?: WebSocketFactory;
  channel?: BroadcastChannel;
  locks?: LockManager;
  clock?: { mono: () => number; wall: () => number };
}

/** Host I/O only. Native code owns connection policy, retry and WAL ordering. */
export class SessionExecutor<S extends NativeSession = EditorSession> {
  readonly session: S;
  private readonly sockets = new Map<number, MinimalWebSocket>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly channel: BroadcastChannel;
  private readonly lease: SessionLease;
  private readonly storage: StorageAdapter;
  private storageQueue: Promise<void>;
  private busy = false;
  private queue: (() => void)[] = [];
  private closed = false;
  private started = false;
  private closing?: Promise<void>;
  private readonly tasks = new Set<Promise<void>>();
  private stopped?: () => void;
  private readonly unsubscribe: () => void;
  private readonly t0: number;
  private detachRoute?: () => void;
  private readonly clock: { mono: () => number; wall: () => number };
  constructor(private readonly options: ExecutorOptions<S>) {
    this.clock = options.clock ?? {
      mono: () => performance.now(),
      wall: () => Date.now(),
    };
    this.t0 = this.clock.mono();
    options.telemetry.identify(options.doc, options.owner);
    let native: S | undefined;
    let lease: SessionLease | undefined;
    let channel: BroadcastChannel | undefined;
    let unsubscribe: (() => void) | undefined;
    let online = false;
    let pagehide = false;
    let visibility = false;
    try {
      this.session = native = options.create(this.now(), this.clock.wall());
      this.lease = lease = new SessionLease(
        options.doc,
        options.owner,
        options.locks
      );
      this.storageQueue = Promise.resolve();
      this.storage =
        options.storage ??
        new StorageAdapter(
          options.doc,
          options.owner,
          options.user,
          options.locks
        );
      this.channel = channel =
        options.channel ?? new BroadcastChannel(`macro-loro-${options.doc}`);

      this.channel.onmessage = (event: MessageEvent<unknown>) => {
        const value = event.data;
        if (typeof value !== 'object' || value === null || !('type' in value))
          return;
        if (
          value.type === 'closing' &&
          'session' in value &&
          typeof value.session === 'string'
        ) {
          const owner = value.session;
          this.run(() =>
            this.session.chatter(
              2,
              new TextEncoder().encode(owner),
              this.now(),
              this.clock.wall()
            )
          );
        }
        if (
          'data' in value &&
          value.data instanceof Uint8Array &&
          (value.type === 'update' || value.type === 'awareness')
        ) {
          const kind = value.type === 'update' ? 0 : 1;
          const data = value.data;
          this.run(() =>
            this.session.chatter(kind, data, this.now(), this.clock.wall())
          );
        }
      };
      this.unsubscribe = unsubscribe = options.auth.subscribe(
        (current, write, comment) =>
          this.run(() =>
            this.session.authorization(
              current,
              write,
              comment,
              this.now(),
              this.clock.wall()
            )
          )
      );
      globalThis.addEventListener?.('online', this.online);
      online = true;
      globalThis.addEventListener?.('pagehide', this.pagehide);
      pagehide = true;
      globalThis.document?.addEventListener(
        'visibilitychange',
        this.visibility
      );
      visibility = true;
    } catch (error) {
      this.closed = true;
      this.queue.length = 0;
      clearTimeout(this.timer);
      const report = (failure: unknown) => {
        try {
          Telemetry.error(failure, { surface: 'session.constructor.cleanup' });
        } catch {
          // A telemetry failure must not replace the original thrown value.
        }
      };
      const cleanup = (call: () => void) => {
        try {
          call();
        } catch (failure) {
          report(failure);
        }
      };
      if (online)
        cleanup(() => globalThis.removeEventListener?.('online', this.online));
      if (pagehide)
        cleanup(() =>
          globalThis.removeEventListener?.('pagehide', this.pagehide)
        );
      if (visibility)
        cleanup(() =>
          globalThis.document?.removeEventListener(
            'visibilitychange',
            this.visibility
          )
        );
      if (unsubscribe) cleanup(unsubscribe);
      if (channel) {
        const accepted = channel;
        cleanup(() => {
          accepted.onmessage = null;
        });
        cleanup(() => accepted.close());
      }
      if (lease) void lease.release().catch(report);
      if (native) {
        const failed = native;
        cleanup(() => options.onConstructionFailure?.(failed));
        cleanup(() => failed.free());
      }
      throw error;
    }
  }
  now = () => this.clock.mono() - this.t0;
  /** All synchronous admission, including view inputs, is serialized here. */
  run(call: () => number, after?: (flags: number) => void): void {
    if (this.closed) return;
    this.queue.push(() => {
      const flags = call();
      this.options.beforeConsume?.(flags);
      this.consume(flags);
      after?.(flags);
    });
    if (this.busy) return;
    this.busy = true;
    let failure: ExecutorFailure | undefined;
    try {
      while (this.queue.length) {
        const call = this.queue.shift();
        if (!call) break;
        call();
      }
    } catch (error) {
      failure = { error };
    } finally {
      this.busy = false;
    }
    try {
      this.options.afterDrain?.(failure);
    } catch (error) {
      if (!failure) throw error;
      try {
        Telemetry.error(error, { surface: 'session.drain.cleanup' });
      } catch {
        // Preserve the original admission failure, including throw undefined.
      }
    }
    if (failure) throw failure.error;
  }
  /** Admit a synchronous transaction without queueing rejected reentrant work. */
  runSync(call: () => number, after?: (flags: number) => void): void {
    if (this.closed || this.closing)
      throw new Error('Session executor is closed or closing');
    if (this.busy || this.queue.length)
      throw new Error('Session executor is busy');
    this.run(call, after);
  }
  start(): void {
    if (this.started) return;
    this.started = true;
    this.run(() =>
      this.session.input(
        SessionInputMsg.encode(emptyInput(0)),
        this.now(),
        this.clock.wall()
      )
    );
    const router = this.options.router;
    if (router)
      this.detachRoute = router.attach(this.options.doc, (event) =>
        this.run(() =>
          this.session.input(
            SessionInputMsg.encode({ ...emptyInput(11), bytes: event }),
            this.now(),
            this.clock.wall()
          )
        )
      );
  }
  private consume(flags: number): void {
    if (flags & Flag.WakeChanged) {
      this.scheduleWake();
    }
    if (!(flags & (Flag.View | Flag.Io | Flag.NeedPeerIds | Flag.Error)))
      return;
    const out = decodeOutput(this.session.takeOutput());
    this.options.view.apply(out.view, out.strings, out.viewEffects);
    for (const effect of out.viewEffects) {
      if (effect.kind === 3) this.options.onStatus?.(effect);
      if (effect.kind === 5 && effect.code === 0) this.stopped?.();
    }
    for (const effect of out.effects) this.execute(effect);
    if (flags & Flag.NeedPeerIds) {
      const values = crypto.getRandomValues(new BigUint64Array(4));
      const input = {
        ...emptyInput(7),
        peers: [...values].map((v) => v & ((1n << 63n) - 1n)),
      };
      this.run(() =>
        this.session.input(
          SessionInputMsg.encode(input),
          this.now(),
          this.clock.wall()
        )
      );
    }
  }
  private scheduleWake(): void {
    clearTimeout(this.timer);
    const at = this.closed ? -1 : this.session.wakeAt();
    this.timer =
      at < 0
        ? undefined
        : setTimeout(
            () => {
              this.timer = undefined;
              this.run(
                () => this.session.tick(this.now(), this.clock.wall()),
                () => {
                  // Browser timers may run before Rust's integer-millisecond deadline.
                  // An unchanged deadline must remain armed after that early tick.
                  if (this.timer === undefined) this.scheduleWake();
                }
              );
            },
            Math.max(0, Math.ceil(at - this.now()))
          );
  }
  private execute(effect: Effect): void {
    if (effect.tag === 1) {
      this.launch(async () => {
        try {
          const result = await this.options.auth.token(
            new TextDecoder().decode(effect.payload)
          );
          this.run(() =>
            this.session.tokenFetched(
              effect.a,
              result.token,
              result.access,
              this.now(),
              this.clock.wall()
            )
          );
        } catch {
          this.run(() =>
            this.session.tokenFetched(
              effect.a,
              undefined,
              0,
              this.now(),
              this.clock.wall()
            )
          );
        }
      });
      return;
    }
    if (effect.tag === 2) {
      const connect = ConnectMsg.decode(effect.payload);
      const socket = (this.options.sockets ?? platformWebSocketFactory)(
        this.options.socketUrl(connect.doc, connect.token, connect.traceparent)
      );
      socket.binaryType = 'arraybuffer';
      this.sockets.set(effect.a, socket);
      socket.onopen = () =>
        this.run(() =>
          this.session.socketOpened(effect.a, this.now(), this.clock.wall())
        );
      socket.onmessage = (event) => {
        if (typeof event.data === 'string')
          this.run(() =>
            this.session.socketText(effect.a, event.data, this.now())
          );
        else if (event.data instanceof ArrayBuffer)
          this.run(() =>
            this.session.socketFrame(
              effect.a,
              new Uint8Array(event.data),
              this.now()
            )
          );
      };
      socket.onclose = (event) => {
        if (this.sockets.get(effect.a) === socket)
          this.sockets.delete(effect.a);
        this.run(() =>
          this.session.socketClosed(
            effect.a,
            event.code,
            event.wasClean,
            this.now(),
            this.clock.wall()
          )
        );
      };
      socket.onerror = () =>
        this.run(() =>
          this.session.socketClosed(
            effect.a,
            1006,
            false,
            this.now(),
            this.clock.wall()
          )
        );
      return;
    }
    if (effect.tag === 3) {
      if (this.options.router) {
        this.options.router.send(this.options.doc, effect.payload);
        return;
      }
      this.sockets.get(effect.a)?.send(effect.payload);
      return;
    }
    if (effect.tag === 4) {
      this.sockets.get(effect.a)?.send('ping');
      return;
    }
    if (effect.tag === 5) {
      const socket = this.sockets.get(effect.a);
      if (socket) {
        if (socket.readyState === socket.CONNECTING)
          socket.addEventListener('open', () => socket.close(effect.b), {
            once: true,
          });
        else socket.close(effect.b);
      }
      return;
    }
    if (effect.tag === 6) {
      const op = StorageOpMsg.decode(effect.payload);
      this.storageQueue = this.storageQueue
        .then(async () => {
          let result: StorageResult | undefined;
          try {
            await this.lease.ready;
            await this.options.telemetry.storage(
              [
                'load',
                'load_orphans',
                'wal_append',
                'wal_mark_delivered',
                'wal_prune',
                'wal_adopt',
                'wal_drop_expired',
                'wal_quarantine',
                'snapshot_save',
                'snapshot_delete',
              ][op.kind] ?? 'unknown',
              async () => {
                result = await this.storage.execute(op);
              }
            );
          } catch {
            result ??=
              op.kind === 0 || op.kind === 1
                ? { kind: 'loaded', failure: Failure.Unavailable }
                : op.kind === 5
                  ? {
                      kind: 'adopted',
                      adopted: -1,
                      failure: Failure.Unavailable,
                    }
                  : { kind: 'done', ok: false, failure: Failure.Unavailable };
          }
          const completion = result;
          if (!completion)
            throw new Error('Storage telemetry did not execute its operation');
          this.run(() =>
            completion.kind === 'loaded'
              ? this.session.storageLoaded(
                  effect.a,
                  completion.payload,
                  completion.failure,
                  this.now(),
                  this.clock.wall()
                )
              : completion.kind === 'adopted'
                ? this.session.storageAdopted(
                    effect.a,
                    completion.adopted,
                    completion.failure,
                    this.now(),
                    this.clock.wall()
                  )
                : this.session.storageDone(
                    effect.a,
                    completion.ok,
                    completion.failure,
                    this.now(),
                    this.clock.wall()
                  )
          );
        })
        .catch((error) => {
          this.options.view.apply(new Uint32Array(), new Uint8Array(), [
            {
              ...emptyViewError(),
              text:
                error instanceof Error
                  ? error.message
                  : 'Storage completion failed',
            },
          ]);
        });
      return;
    }
    if (effect.tag === 7) {
      if (effect.a === 2) return;
      this.channel.postMessage({
        type: effect.a === 0 ? 'update' : 'awareness',
        data: effect.payload,
      });
      return;
    }
    if (effect.tag === 8) {
      this.options.telemetry.forward(TelemetryMsg.decode(effect.payload));
      return;
    }
    if (effect.tag === 9) {
      this.detachRoute?.();
      this.detachRoute = undefined;
      return;
    }
    if (effect.tag === 10 && this.options.router) {
      this.options.router.reconnect(this.options.doc);
      return;
    }
    throw new Error(`Unsupported executor effect ${effect.tag}`);
  }
  private launch(operation: () => Promise<void>): void {
    const task = operation()
      .catch((error) => {
        this.options.view.apply(new Uint32Array(), new Uint8Array(), [
          {
            ...emptyViewError(),
            text:
              error instanceof Error
                ? error.message
                : 'Executor operation failed',
          },
        ]);
      })
      .finally(() => {
        this.tasks.delete(task);
      });
    this.tasks.add(task);
  }
  /** Wait for currently admitted asynchronous work; does not advance native deadlines. */
  async idle(): Promise<void> {
    for (;;) {
      const queue = this.storageQueue;
      await Promise.all([...this.tasks]);
      await queue;
      if (queue === this.storageQueue && this.tasks.size === 0) return;
    }
  }
  private online = () => {
    this.options.router?.host(0);
    this.run(() => this.session.host(0, this.now(), this.clock.wall()));
  };
  private visibility = () => {
    if (document.visibilityState === 'visible')
      this.launch(() => this.visible());
    else this.run(() => this.session.host(2, this.now(), this.clock.wall()));
  };
  private pagehide = () => {
    this.launch(() => this.close());
  };
  /** Tauri recover completes before native Visible admission. */
  async visible(): Promise<void> {
    await this.options.router?.visible();
    for (const socket of this.sockets.values()) {
      if ('recover' in socket && typeof socket.recover === 'function')
        await socket.recover();
    }
    this.run(() => this.session.host(1, this.now(), this.clock.wall()));
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      const terminal = new Promise<void>((resolve) => {
        this.stopped = resolve;
      });
      const input = { ...emptyInput(5), request: 0xffffffff };
      this.run(() =>
        this.session.input(
          SessionInputMsg.encode(input),
          this.now(),
          this.clock.wall()
        )
      );
      try {
        await terminal;
        await this.storageQueue;
        await this.storage.drain();
        await this.lease.release();
        this.channel.postMessage({
          type: 'closing',
          session: this.options.owner,
        });
      } finally {
        this.closed = true;
        this.channel.close();
        clearTimeout(this.timer);
        this.detachRoute?.();
        this.detachRoute = undefined;
        this.unsubscribe();
        globalThis.removeEventListener?.('online', this.online);
        globalThis.removeEventListener?.('pagehide', this.pagehide);
        globalThis.document?.removeEventListener(
          'visibilitychange',
          this.visibility
        );
        this.options.telemetry.close();
        this.session.free();
      }
    })();
    return this.closing;
  }
}
function emptyViewError(): IViewEffectMsg {
  return {
    kind: 2,
    request: 0,
    code: 0,
    detail: 0,
    flag: false,
    text: '',
    selection: {
      kind: 0,
      anchor: { key: 0, offset: 0, type: 0 },
      focus: { key: 0, offset: 0, type: 0 },
      nodes: [],
      table: 0,
      dirty: false,
    },
    format: 0,
    style: '',
    keys: [],
    values: [],
    events: [],
    paths: [],
    closedReason: ClosedReason.None,
    saveReason: SaveReason.None,
  };
}

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
  type INodeCursorMsg,
  type IViewEffectMsg,
  NodeCursorMsg,
  SaveReason,
  SessionInputMsg,
  TelemetryMsg,
} from './abi.generated';
import { emptyInput } from './input';
import { SessionLease } from './lease';
import {
  bindCodeTokenCauses,
  decodeOutput,
  type Effect,
  Flag,
  withSingleCodeTokenCause,
} from './output';
import type { SessionRouter } from './router';
import {
  decodeStorageOperation,
  StorageAdapter,
  type StorageResult,
  storageFailure,
  storageOperationName,
} from './storage';
import type { SessionTelemetry } from './telemetry';
import type { DocSession, EditorSession } from './wasm.generated';

export type NativeSession = EditorSession | DocSession;
export interface SessionAuthorization {
  token(doc: string): Promise<{ token: string; access: number }>;
  subscribe(
    callback: (current: boolean, canWrite: boolean, canComment: boolean) => void
  ): () => void;
}
/** Owned output boundary, before cause getters or any renderer callback. */
export interface ExecutorOwnedTransfer {
  readonly flags: number;
  readonly completion?: ExecutorCompletion;
  readonly words: Uint32Array;
  readonly strings: Uint8Array;
  readonly effects: readonly IViewEffectMsg[];
}
export interface ViewApplier {
  /** Internal owner observation; must not transfer output or call native code. */
  readonly ownedTransfer?: (transfer: ExecutorOwnedTransfer) => void;
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
/** Actual pre-entry scheduling result; completed grants no native authority. */
export type SyncEntrySchedule =
  | { readonly status: 'refused'; readonly reason: 'busy-queued' }
  | { readonly status: 'completed' };
/** Terminal observation of this entry, not durability or native quiescence. */
export type ExecutorSettlement =
  | { readonly status: 'success'; readonly flags: number }
  | { readonly status: 'error'; readonly error: unknown }
  | {
      readonly status: 'cancelled';
      readonly reason:
        | 'closed'
        | 'closing'
        | 'session-access'
        | 'entry-admission';
    };

/** Consumer-owned deferred errors may be associated only with this real entry. */
export interface ExecutorCompletion {
  readonly running: boolean;
  /** Existing decoded Error output for this real entry; never handling/publication proof. */
  readonly nativeFailure: ExecutorFailure | undefined;
  fail(error: unknown): void;
  /** Host cleanup/rendering fault; cannot replace an actual native error. */
  failSecondary(error: unknown): void;
}
export interface ExecutorDrain {
  /** Exact entries started by this drain; excludes queued and nested drains. */
  readonly ownsCompletion: (completion: ExecutorCompletion) => boolean;
  /** The thrown drain error belongs to an observed input, not the whole fence. */
  attributeFailure(): void;
}
export interface SettledRunOptions {
  readonly synchronous?: boolean;
  readonly after?: (flags: number) => void;
  /** Check current session authority in this queue turn before materialization. */
  readonly admit?: () => boolean;
  /** Caller validity, checked after authority and before materialization. */
  readonly admitEntry?: () => boolean;
}
interface SettledEntry {
  started: boolean;
  running: boolean;
  delivered: boolean;
  flags?: number;
  exception?: ExecutorFailure;
  reported?: ExecutorFailure;
  secondary?: ExecutorFailure;
  native?: ExecutorFailure;
  cancelled?: 'session-access' | 'entry-admission';
  readonly admit?: () => boolean;
  /** Caller validity, checked after authority and before materialization. */
  readonly admitEntry?: () => boolean;
  readonly completion: ExecutorCompletion;
  readonly notify: (result: ExecutorSettlement) => void;
}
/** Native failure data is distinct from an original opaque JavaScript exception. */
export class SessionInputError extends Error {
  constructor(readonly effects: readonly IViewEffectMsg[]) {
    super('Native session input failed');
    this.name = 'SessionInputError';
  }
}
/** Server-current annotation change, published from an isolated staging peer. */
export type CommentMarkAction =
  | {
      readonly kind: 'add';
      readonly anchor: INodeCursorMsg;
      readonly focus: INodeCursorMsg;
      /** Exact text expected between the durable cursors. */
      readonly text: string;
    }
  | { readonly kind: 'remove' };
export type CommentMarkReply =
  | { readonly kind: 'accepted' }
  | { readonly kind: 'not-acked' }
  | { readonly kind: 'refused'; readonly reason: string };
/** Durability of local edits at a flush reply (Rust FlushReply). */
export type FlushReply =
  | { readonly kind: 'drained' }
  | { readonly kind: 'not-drained'; readonly undelivered: number }
  | { readonly kind: 'offline' }
  | { readonly kind: 'read-only' };
const FLUSH_REPLY_CODE = 1;
const COMMENT_REPLY_CODE = 2;
const REPLY_EFFECT = 5;
const FLUSH_INPUT = 4;
const COMMENT_INPUT = 9;
/** Stop owns 0xffffffff; correlated requests cycle below it. */
const MAX_REQUEST = 0xfffffffe;

export interface ExecutorOptions<S extends NativeSession> {
  doc: string;
  owner: string;
  user: string;
  create: (now: number, wall: number) => S;
  /** Release typed host ownership before native free if executor construction fails. */
  onConstructionFailure?: (session: S) => void;
  /** Inspect issued callback metadata after a native call and before output transfer. */
  beforeConsume?: (flags: number, completion?: ExecutorCompletion) => void;
  /** Complete invocation cleanup after the outer FIFO exits and synchronous admission unlocks. */
  afterDrain?: (failure?: ExecutorFailure, drain?: ExecutorDrain) => void;
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
  private activeDrain: ExecutorDrain | undefined;
  private tickSequence = 0;
  private pendingTickSequence: number | undefined;
  private queue: (() => void)[] = [];
  private readonly settlements = new Map<() => void, SettledEntry>();
  private closed = false;
  private started = false;
  private closing?: Promise<void>;
  private readonly tasks = new Set<Promise<void>>();
  private stopped?: () => void;
  private nextRequest = 1;
  private readonly replies = new Map<
    number,
    {
      code: number;
      settle: (effect: IViewEffectMsg) => void;
      reject: (error: Error) => void;
    }
  >();
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
    this.enqueue(call, after);
  }
  /** Observe actual execution; legacy outer errors still propagate synchronously. */
  runSettled(
    call: () => number,
    notify: (result: ExecutorSettlement) => void,
    options: SettledRunOptions = {}
  ): void {
    if (options.synchronous && (this.busy || this.queue.length))
      throw new Error('Session executor is busy');
    if (this.closed || this.closing) {
      this.notifySettlement(notify, {
        status: 'cancelled',
        reason: this.closed ? 'closed' : 'closing',
      });
      return;
    }
    const entry = this.createSettledEntry(notify, options);
    this.enqueue(call, options.after, entry);
  }
  private createSettledEntry(
    notify: (result: ExecutorSettlement) => void,
    options: SettledRunOptions = {}
  ): SettledEntry {
    const entry: SettledEntry = {
      started: false,
      running: false,
      delivered: false,
      notify,
      admit: options.admit,
      admitEntry: options.admitEntry,
      completion: {
        get running() {
          return entry.running;
        },
        get nativeFailure() {
          return entry.native;
        },
        fail(error) {
          if (entry.delivered)
            throw new Error('Executor settlement already delivered');
          entry.reported ??= { error };
        },
        failSecondary(error) {
          if (entry.delivered)
            throw new Error('Executor settlement already delivered');
          entry.secondary ??= { error };
        },
      },
    };
    return entry;
  }
  private notifySettlement(
    notify: (result: ExecutorSettlement) => void,
    result: ExecutorSettlement
  ): void {
    try {
      notify(result);
    } catch (error) {
      try {
        Telemetry.error(error, { surface: 'session.settlement.notification' });
      } catch {
        /* A notifier cannot replace an admission or drain error. */
      }
    }
  }
  private enqueue(
    call: () => number,
    after?: (flags: number) => void,
    entry?: SettledEntry,
    finish?: () => void
  ): void {
    if (this.closed) return;
    const execute = () => {
      try {
        const flags = call();
        const tickSequence = this.pendingTickSequence;
        this.pendingTickSequence = undefined;
        if (entry) entry.flags = flags;
        if (entry) this.options.beforeConsume?.(flags, entry.completion);
        else this.options.beforeConsume?.(flags);
        this.consume(flags, entry, tickSequence);
        after?.(flags);
      } finally {
        // Entry cleanup must precede FIFO continuation and unlocked afterDrain.
        try {
          finish?.();
        } catch (error) {
          // Preserve this actual accepted entry's cleanup-only failure as an
          // error settlement. An earlier exception/reported/native error wins.
          if (entry) entry.secondary ??= { error };
          try {
            Telemetry.error(error, { surface: 'session.sync-entry.cleanup' });
          } catch {
            // Cleanup cannot replace the entry's opaque primary failure.
          }
        }
      }
    };
    const queued = entry
      ? () => {
          entry.running = true;
          try {
            if (entry.admit) {
              const admitted = entry.admit();
              if (typeof admitted !== 'boolean')
                throw new TypeError('Session admission must return a boolean');
              if (!admitted) {
                entry.cancelled = 'session-access';
                return;
              }
            }
            if (entry.admitEntry) {
              const admitted = entry.admitEntry();
              if (typeof admitted !== 'boolean')
                throw new TypeError('Entry admission must return a boolean');
              if (!admitted) {
                entry.cancelled = 'entry-admission';
                return;
              }
            }
            execute();
          } catch (error) {
            entry.exception ??= { error };
            throw error;
          } finally {
            entry.running = false;
          }
        }
      : execute;
    if (entry) this.settlements.set(queued, entry);
    this.queue.push(queued);
    if (this.busy) return;
    const owned = new Set<ExecutorCompletion>();
    let attributed = false;
    const drain: ExecutorDrain = Object.freeze({
      ownsCompletion: (completion: ExecutorCompletion) => owned.has(completion),
      attributeFailure() {
        attributed = true;
      },
    });
    const previousDrain = this.activeDrain;
    this.activeDrain = drain;
    try {
      this.busy = true;
      let completed: SettledEntry[] | undefined;
      let failure: ExecutorFailure | undefined;
      try {
        while (this.queue.length) {
          const next = this.queue.shift();
          if (!next) break;
          const settlement = this.settlements.get(next);
          if (settlement) {
            this.settlements.delete(next);
            settlement.started = true;
            completed ??= [];
            completed.push(settlement);
            owned.add(settlement.completion);
          }
          next();
        }
      } catch (error) {
        failure = { error };
      } finally {
        this.busy = false;
      }
      let drainFailure: ExecutorFailure | undefined;
      try {
        this.options.afterDrain?.(failure, drain);
      } catch (error) {
        if (!failure) drainFailure = { error };
        else {
          try {
            Telemetry.error(error, { surface: 'session.drain.cleanup' });
          } catch {
            /* Preserve the original admission failure, including throw undefined. */
          }
        }
      }
      for (const settlement of completed ?? []) {
        const own =
          settlement.exception ??
          settlement.reported ??
          settlement.native ??
          settlement.secondary ??
          (!attributed ? drainFailure : undefined);
        settlement.delivered = true;
        const result: ExecutorSettlement = settlement.cancelled
          ? { status: 'cancelled', reason: settlement.cancelled }
          : own
            ? { status: 'error', error: own.error }
            : settlement.flags === undefined
              ? {
                  status: 'error',
                  error: new Error('Native input completed without flags'),
                }
              : { status: 'success', flags: settlement.flags };
        this.notifySettlement(settlement.notify, result);
      }
      if (failure) throw failure.error;
      if (drainFailure) throw drainFailure.error;
    } finally {
      // Includes inherited drain callbacks and settlement notification reentry.
      this.activeDrain = previousDrain;
    }
  }

  /** Actual synchronous execution fence; never input handling or publication proof. */
  get runningDrain(): ExecutorDrain | undefined {
    return this.activeDrain;
  }
  /** Read-only scheduling fact; grants no native or output-consumption authority. */
  get metadataReadIdle(): boolean {
    return (
      !this.busy && this.queue.length === 0 && !this.closed && !this.closing
    );
  }
  /** Admit a synchronous transaction without queueing rejected reentrant work. */
  runSync(call: () => number, after?: (flags: number) => void): void {
    if (this.closed || this.closing)
      throw new Error('Session executor is closed or closing');
    if (this.busy || this.queue.length)
      throw new Error('Session executor is busy');
    this.run(call, after);
  }
  /** Scheduling outcome only; never native handling or commit evidence. */
  tryRunSync(
    call: (completion: ExecutorCompletion) => number,
    after: ((flags: number) => void) | undefined,
    finish: () => void
  ): SyncEntrySchedule {
    if (this.closed || this.closing)
      throw new Error('Session executor is closed or closing');
    if (this.busy || this.queue.length)
      return { status: 'refused', reason: 'busy-queued' };
    let settlement: ExecutorSettlement | undefined;
    const entry = this.createSettledEntry((result) => {
      settlement = result;
    });
    this.enqueue(() => call(entry.completion), after, entry, finish);
    if (settlement?.status === 'error') throw settlement.error;
    if (settlement?.status !== 'success')
      throw new Error('Synchronous input did not complete');
    return { status: 'completed' };
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
  private consume(
    flags: number,
    entry?: SettledEntry,
    tickSequence?: number
  ): void {
    if (flags & Flag.WakeChanged) {
      this.scheduleWake();
    }
    if (!(flags & (Flag.View | Flag.Io | Flag.NeedPeerIds | Flag.Error)))
      return;
    const out = decodeOutput(this.session.takeOutput());
    // This boundary precedes legitimate guarded cause getters. The hook observes
    // this transferred packet, never a later global output or inferred token gap.
    this.options.view.ownedTransfer?.({
      flags,
      completion: entry?.completion,
      words: out.view,
      strings: out.strings,
      effects: out.viewEffects,
    });
    if (
      (Boolean(flags & Flag.Error) ||
        out.viewEffects.some(
          (effect) => effect.kind === 6 && effect.code === 10
        )) &&
      'takeCodeTokenFailure' in this.session
    )
      bindCodeTokenCauses(this.session, out.viewEffects);
    if (entry && flags & Flag.Error) {
      const failed = out.viewEffects.filter(
        (effect) => effect.kind === 2 || effect.kind === 6
      );
      // The cause only when exactly one failed effect carries a tokenizer throw.
      entry.native = {
        error: withSingleCodeTokenCause(new SessionInputError(failed), failed),
      };
    }
    this.options.view.apply(out.view, out.strings, out.viewEffects);
    for (const effect of out.viewEffects) {
      if (effect.kind === 3) this.options.onStatus?.(effect);
      if (effect.kind === REPLY_EFFECT && effect.code === 0) this.stopped?.();
      if (effect.kind === REPLY_EFFECT) this.settleReply(effect);
    }
    for (const effect of out.effects) this.execute(effect, tickSequence);
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
  /** Resolves with the session's reply; rejects if the session closes first. */
  comment(
    markId: string,
    action: CommentMarkAction
  ): Promise<CommentMarkReply> {
    return this.request(
      COMMENT_REPLY_CODE,
      {
        ...emptyInput(COMMENT_INPUT),
        markId,
        ...(action.kind === 'add'
          ? {
              code: 1,
              // Bebop encodes into one shared buffer; copy before the next encode.
              anchor: NodeCursorMsg.encode(action.anchor).slice(),
              focus: NodeCursorMsg.encode(action.focus).slice(),
              expectedText: action.text,
            }
          : { code: 0 }),
      },
      (effect): CommentMarkReply | Error => {
        if (effect.detail === 0) return { kind: 'accepted' };
        if (effect.detail === 1) return { kind: 'not-acked' };
        if (effect.detail === 2)
          return { kind: 'refused', reason: effect.text };
        return new Error('Unknown comment reply ' + effect.detail);
      }
    );
  }
  /** Append local edits and resolve once they are delivered or cannot be. */
  flush(): Promise<FlushReply> {
    return this.request(
      FLUSH_REPLY_CODE,
      emptyInput(FLUSH_INPUT),
      (effect): FlushReply | Error => {
        if (effect.detail === 0) return { kind: 'drained' };
        if (effect.detail === 1)
          return { kind: 'not-drained', undelivered: effect.format };
        if (effect.detail === 2) return { kind: 'offline' };
        if (effect.detail === 3) return { kind: 'read-only' };
        return new Error('Unknown flush reply ' + effect.detail);
      }
    );
  }
  private request<Reply>(
    code: number,
    input: ReturnType<typeof emptyInput>,
    decode: (effect: IViewEffectMsg) => Reply | Error
  ): Promise<Reply> {
    if (this.closed || this.closing)
      return Promise.reject(new Error('Session closed before the request'));
    const request = this.nextRequest;
    this.nextRequest = request >= MAX_REQUEST ? 1 : request + 1;
    const reply = new Promise<Reply>((resolve, reject) => {
      this.replies.set(request, {
        code,
        reject,
        settle: (effect) => {
          const value = decode(effect);
          if (value instanceof Error) reject(value);
          else resolve(value);
        },
      });
    });
    try {
      this.run(() =>
        this.session.input(
          SessionInputMsg.encode({ ...input, request }),
          this.now(),
          this.clock.wall()
        )
      );
    } catch (error) {
      // The caller receives the admission error; close must not reject an
      // abandoned reply nobody holds. Cursor encoding runs before registration.
      this.replies.delete(request);
      throw error;
    }
    return reply;
  }
  private settleReply(effect: IViewEffectMsg): void {
    const pending = this.replies.get(effect.request);
    if (!pending || pending.code !== effect.code) return;
    this.replies.delete(effect.request);
    pending.settle(effect);
  }
  private rejectReplies(): void {
    const pending = [...this.replies.values()];
    this.replies.clear();
    for (const { reject } of pending)
      reject(new Error('Session closed before the reply'));
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
                () => {
                  const sequence = ++this.tickSequence;
                  const flags = this.options.telemetry.tick(
                    sequence,
                    (span) => {
                      const start = this.clock.mono();
                      try {
                        return this.session.tick(this.now(), this.clock.wall());
                      } finally {
                        span.setAttr(
                          'native.tick.duration_ms',
                          this.clock.mono() - start
                        );
                      }
                    }
                  );
                  this.pendingTickSequence = sequence;
                  return flags;
                },
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
  private execute(effect: Effect, tickSequence?: number): void {
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
      const op = decodeStorageOperation(effect.payload);
      this.storageQueue = this.storageQueue
        .then(async () => {
          let result: StorageResult | undefined;
          try {
            await this.lease.ready;
            await this.options.telemetry.storage(
              storageOperationName(op.kind),
              async () => {
                result = await this.storage.execute(op);
              }
            );
          } catch {
            result ??= storageFailure(op.kind, Failure.Unavailable);
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
      this.options.telemetry.forward(
        TelemetryMsg.decode(effect.payload),
        tickSequence
      );
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
    let resolveClose!: () => void;
    let rejectClose!: (error: unknown) => void;
    const closing = new Promise<void>((resolve, reject) => {
      resolveClose = resolve;
      rejectClose = reject;
    });
    this.closing = closing;
    const finish = async () => {
      let failure: ExecutorFailure | undefined;
      const remember = (error: unknown) => {
        if (!failure) failure = { error };
        else {
          try {
            Telemetry.error(error, { surface: 'session.close.cleanup' });
          } catch {
            /* Preserve the original close failure. */
          }
        }
      };
      const cleanup = (call: () => void) => {
        try {
          call();
        } catch (error) {
          remember(error);
        }
      };
      const terminal = new Promise<void>((resolve) => {
        this.stopped = resolve;
      });
      const input = { ...emptyInput(5), request: 0xffffffff };
      try {
        this.run(() =>
          this.session.input(
            SessionInputMsg.encode(input),
            this.now(),
            this.clock.wall()
          )
        );
        await terminal;
      } catch (error) {
        remember(error);
      }
      // Even an aborted Stop/drain cannot release ownership over admitted writes.
      for (;;) {
        const queued = this.storageQueue;
        try {
          await queued;
        } catch (error) {
          remember(error);
        }
        try {
          await this.storage.drain();
        } catch (error) {
          remember(error);
        }
        if (this.storageQueue === queued) break;
      }
      // Required durability completions have settled; do not admit new work
      // while asynchronous lock release hands ownership to another session.
      this.closed = true;
      this.rejectReplies();
      this.queue = this.queue.filter((call) => {
        const entry = this.settlements.get(call);
        if (!entry || entry.started) return true;
        this.settlements.delete(call);
        entry.delivered = true;
        this.notifySettlement(entry.notify, {
          status: 'cancelled',
          reason: 'closed',
        });
        return false;
      });
      try {
        await this.lease.release();
      } catch (error) {
        remember(error);
      }
      cleanup(() =>
        this.channel.postMessage({
          type: 'closing',
          session: this.options.owner,
        })
      );
      cleanup(() => this.channel.close());
      clearTimeout(this.timer);
      cleanup(() => this.detachRoute?.());
      this.detachRoute = undefined;
      cleanup(() => this.unsubscribe());
      cleanup(() => globalThis.removeEventListener?.('online', this.online));
      cleanup(() =>
        globalThis.removeEventListener?.('pagehide', this.pagehide)
      );
      cleanup(() =>
        globalThis.document?.removeEventListener(
          'visibilitychange',
          this.visibility
        )
      );
      cleanup(() => this.options.telemetry.close());
      cleanup(() => this.session.free());
      if (failure) throw failure.error;
    };
    finish().then(resolveClose, rejectClose);
    return closing;
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

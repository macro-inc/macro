/**
 * A deterministic browser for the handover checker. Every source of
 * nondeterminism the cache depends on goes through here: message delivery
 * between pages, the coordinator and engines; timers and the clock; Web Locks;
 * BroadcastChannel; ids and jitter. The checker decides what happens next, one
 * delivery or timer at a time, and replays a run from its choices.
 *
 * Several 'contexts' (pages, SharedWorker globals, engine workers) share one JS
 * realm. AsyncLocalStorage carries the current context through every promise
 * continuation, so browser globals (visibility, `navigator.locks`, page event
 * listeners) answer for the context that is running.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { fireAndForget } from '@core/util/fireAndForget';

export type ContextKind = 'page' | 'coordinator' | 'engine' | 'holder';

export class SimContext {
  alive = true;
  frozen = false;
  readonly listeners = new Map<string, Set<EventListenerLike>>();
  visibilityState: DocumentVisibilityState = 'visible';
  onLine = true;
  constructor(
    readonly id: string,
    readonly kind: ContextKind,
    /** The page a worker belongs to; a worker dies with its page. */
    readonly parent: SimContext | undefined,
    readonly buildTime: number
  ) {}
}

type EventListenerLike =
  | ((event: unknown) => unknown)
  | { handleEvent(event: unknown): unknown };

type Delivery = {
  seq: number;
  channel: string;
  sender: SimContext | undefined;
  target: SimPort | SimBroadcastChannel | SimLockGrant;
  data: unknown;
  ports: SimPort[];
};

type Timer = {
  id: number;
  at: number;
  seq: number;
  context: SimContext | undefined;
  fn: () => void;
  interval?: number;
  label: string;
};

export class SimPort {
  peer: SimPort | undefined;
  closed = false;
  started = false;
  private handler: ((event: unknown) => unknown) | null = null;
  private handlerContext: SimContext | undefined;
  private readonly listeners = new Map<
    string,
    Map<EventListenerLike, SimContext | undefined>
  >();
  onmessageerror: ((event: unknown) => unknown) | null = null;

  constructor(
    private readonly sim: Sim,
    readonly id: string
  ) {}

  get onmessage(): ((event: unknown) => unknown) | null {
    return this.handler;
  }

  set onmessage(value: ((event: unknown) => unknown) | null) {
    this.handler = value;
    this.handlerContext = this.sim.current();
    if (value) this.started = true;
  }

  addEventListener(type: string, listener: EventListenerLike): void {
    let entries = this.listeners.get(type);
    if (!entries) {
      entries = new Map();
      this.listeners.set(type, entries);
    }
    entries.set(listener, this.sim.current());
  }

  removeEventListener(type: string, listener: EventListenerLike): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: { type: string; data?: unknown }): boolean {
    this.receive(event.data, []);
    return true;
  }

  postMessage(
    message: unknown,
    transfer: Transferable[] | StructuredSerializeOptions = []
  ): void {
    const peer = this.peer;
    if (this.closed || !peer || peer.closed) return;
    const ports = (
      Array.isArray(transfer) ? transfer : (transfer.transfer ?? [])
    ).filter((port): port is SimPort & Transferable => port instanceof SimPort);
    this.sim.enqueue({
      channel: `port:${this.id}`,
      target: peer,
      data: message,
      ports,
    });
  }

  start(): void {
    this.started = true;
  }

  /** Set on a worker's own scope, whose close ends the worker. */
  onClose: (() => void) | undefined;

  close(): void {
    this.closed = true;
    this.onClose?.();
  }

  /** Runs this port's handlers in the contexts that installed them. */
  receive(data: unknown, ports: SimPort[]): void {
    if (this.closed) return;
    const event = { data, ports, target: this, type: 'message' };
    if (this.handler) {
      const handler = this.handler;
      this.sim.runIn(this.handlerContext, () => handler.call(this, event));
    }
    for (const [listener, context] of this.listeners.get('message') ?? []) {
      this.sim.runIn(context, () =>
        typeof listener === 'function'
          ? listener.call(this, event)
          : listener.handleEvent(event)
      );
    }
  }

  /**
   * Whether a delivery to this port would run any code. A port nobody started
   * yet (in transit, or before its handler is set) queues its messages.
   */
  receiverAlive(): boolean {
    if (this.closed) return false;
    if (!this.started) return true;
    const contexts = [
      ...(this.handler ? [this.handlerContext] : []),
      ...(this.listeners.get('message')?.values() ?? []),
    ];
    return contexts.some((context) => !context || context.alive);
  }

  receiverFrozen(): boolean {
    const contexts = [
      ...(this.handler ? [this.handlerContext] : []),
      ...(this.listeners.get('message')?.values() ?? []),
    ];
    return contexts.some((context) => context?.frozen === true);
  }
}

export class SimMessageChannel {
  readonly port1: SimPort;
  readonly port2: SimPort;
  constructor(sim: Sim) {
    const id = sim.nextId('ch');
    this.port1 = new SimPort(sim, `${id}a`);
    this.port2 = new SimPort(sim, `${id}b`);
    this.port1.peer = this.port2;
    this.port2.peer = this.port1;
  }
}

export class SimBroadcastChannel {
  onmessage: ((event: unknown) => unknown) | null = null;
  closed = false;
  readonly context: SimContext | undefined;
  readonly id: string;
  constructor(
    private readonly sim: Sim,
    readonly name: string
  ) {
    this.context = sim.current();
    this.id = sim.nextId('bc');
    sim.broadcastChannels.add(this);
  }

  postMessage(message: unknown): void {
    if (this.closed) return;
    for (const other of this.sim.broadcastChannels) {
      if (other === this || other.closed || other.name !== this.name) continue;
      this.sim.enqueue({
        channel: `bc:${this.id}->${other.id}`,
        target: other,
        data: message,
        ports: [],
      });
    }
  }

  receive(data: unknown): void {
    if (this.closed || !this.onmessage) return;
    const handler = this.onmessage;
    this.sim.runIn(this.context, () => handler.call(this, { data }));
  }

  close(): void {
    this.closed = true;
    this.sim.broadcastChannels.delete(this);
  }
}

type HeldLock = { name: string; mode: LockMode; context: SimContext };
type LockRequest = {
  name: string;
  mode: LockMode;
  context: SimContext;
  callback: (lock: Lock | null) => unknown;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

/**
 * A lock grant that crosses processes: another context died and the browser
 * hands its lock on. It is scheduled like a message, so it can arrive before
 * or after what the dead context posted just before it died.
 */
export class SimLockGrant {
  readonly closed = false;
  constructor(
    readonly context: SimContext,
    private readonly run: () => void
  ) {}

  receive(): void {
    this.run();
  }
}

/** Web Locks for one origin, with the browser's grant order. */
export class SimLockManager {
  private readonly held: HeldLock[] = [];
  private deferGrants = false;
  private readonly queue: LockRequest[] = [];

  constructor(private readonly sim: Sim) {}

  request(
    name: string,
    optionsOrCallback: LockOptions | ((lock: Lock | null) => unknown),
    maybeCallback?: (lock: Lock | null) => unknown
  ): Promise<unknown> {
    const options =
      typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
    const callback =
      typeof optionsOrCallback === 'function'
        ? optionsOrCallback
        : (maybeCallback as (lock: Lock | null) => unknown);
    const context = this.sim.current() ?? this.sim.rootContext;
    const mode = options.mode ?? 'exclusive';
    return new Promise((resolve, reject) => {
      if (!context.alive) return;
      if (options.signal?.aborted) {
        reject(new DOMException('aborted', 'AbortError'));
        return;
      }
      const request: LockRequest = {
        name,
        mode,
        context,
        callback,
        resolve,
        reject,
      };
      if (options.steal) {
        for (const lock of this.held.filter((held) => held.name === name))
          this.release(lock);
        this.grant(request);
        return;
      }
      if (options.ifAvailable && !this.grantable(name, mode, true)) {
        this.sim.task(context, 'lock-unavailable', () => {
          this.settle(request, null);
        });
        return;
      }
      this.queue.push(request);
      options.signal?.addEventListener('abort', () => {
        const index = this.queue.indexOf(request);
        if (index < 0) return;
        this.queue.splice(index, 1);
        reject(new DOMException('aborted', 'AbortError'));
      });
      this.pump();
    });
  }

  async query(): Promise<LockManagerSnapshot> {
    return {
      held: this.held.map((lock) => ({
        name: lock.name,
        mode: lock.mode,
        clientId: lock.context.id,
      })),
      pending: this.queue.map((request) => ({
        name: request.name,
        mode: request.mode,
        clientId: request.context.id,
      })),
    };
  }

  /** A context ended: the browser releases its locks and drops its requests. */
  dropContext(context: SimContext): void {
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (this.queue[index]?.context === context) this.queue.splice(index, 1);
    }
    this.deferGrants = true;
    try {
      for (const lock of this.held.filter((held) => held.context === context))
        this.release(lock);
      this.pump();
    } finally {
      this.deferGrants = false;
    }
  }

  private grantable(name: string, mode: LockMode, ignoreQueue: boolean) {
    const holders = this.held.filter((lock) => lock.name === name);
    if (holders.length === 0)
      return ignoreQueue || !this.queue.some((r) => r.name === name);
    return mode === 'shared' && holders.every((lock) => lock.mode === 'shared');
  }

  private pump(): void {
    for (let index = 0; index < this.queue.length; ) {
      const request = this.queue[index];
      if (!request) break;
      const earlier = this.queue
        .slice(0, index)
        .some((other) => other.name === request.name);
      if (!earlier && this.grantable(request.name, request.mode, true)) {
        this.queue.splice(index, 1);
        this.grant(request);
        continue;
      }
      index += 1;
    }
  }

  private grant(request: LockRequest): void {
    const lock: HeldLock = {
      name: request.name,
      mode: request.mode,
      context: request.context,
    };
    this.held.push(lock);
    this.pendingHeld.set(request, lock);
    const run = () =>
      this.settle(request, { name: request.name, mode: request.mode });
    if (this.deferGrants) {
      this.sim.enqueue({
        channel: `lock:${request.name}`,
        target: new SimLockGrant(request.context, run),
        data: { kind: 'lock-granted' },
        ports: [],
      });
      return;
    }
    this.sim.task(request.context, `lock-granted:${request.name}`, run);
  }

  private readonly pendingHeld = new Map<LockRequest, HeldLock>();

  /** Runs the callback; the lock is held until what it returns settles. */
  private settle(request: LockRequest, lock: Lock | null): void {
    const held = this.pendingHeld.get(request);
    this.pendingHeld.delete(request);
    if (!request.context.alive) {
      if (held) this.release(held);
      return;
    }
    const run = async () => {
      try {
        const value = await request.callback(lock as Lock);
        if (held) this.release(held);
        request.resolve(value);
      } catch (error) {
        if (held) this.release(held);
        request.reject(error);
      }
    };
    this.sim.start(request.context, run);
  }

  /** A lock passed on after a release reaches its next holder like a
   * message from another process, ordered with the releaser's messages. */
  private release(lock: HeldLock): void {
    const index = this.held.indexOf(lock);
    if (index < 0) return;
    this.held.splice(index, 1);
    const defer = this.deferGrants;
    this.deferGrants = true;
    try {
      this.pump();
    } finally {
      this.deferGrants = defer;
    }
  }
}

/** A recorded step: what the scheduler chose, for replay and for reports. */
export type Step =
  | { kind: 'deliver'; channel: string; summary: string }
  | { kind: 'timer'; label: string; at: number }
  | { kind: 'fault'; fault: string };

const nativeSetImmediate = globalThis.setImmediate;

/** One for every run: each AsyncLocalStorage that ran slows every promise. */
const RUNNING_CONTEXT = new AsyncLocalStorage<SimContext>();

export class Sim {
  readonly rootContext = new SimContext('root', 'page', undefined, 0);
  readonly contexts: SimContext[] = [];
  readonly locks = new SimLockManager(this);
  readonly broadcastChannels = new Set<SimBroadcastChannel>();
  now = 1_000_000;
  private seq = 0;
  private ids = 0;
  private uuid = 0;
  private readonly deliveries: Delivery[] = [];
  private readonly tasks: {
    context: SimContext | undefined;
    fn: () => void;
    label: string;
  }[] = [];
  private readonly timers = new Map<number, Timer>();
  private timerIds = 1;
  /** Errors thrown from handlers or timers, which a browser would report. */
  readonly uncaught: unknown[] = [];

  current(): SimContext | undefined {
    return RUNNING_CONTEXT.getStore();
  }

  nextId(prefix: string): string {
    this.ids += 1;
    return `${prefix}${this.ids}`;
  }

  randomUUID(): `${string}-${string}-${string}-${string}-${string}` {
    this.uuid += 1;
    const hex = this.uuid.toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${hex}`;
  }

  context(
    id: string,
    kind: ContextKind,
    parent: SimContext | undefined,
    buildTime: number
  ): SimContext {
    const context = new SimContext(id, kind, parent, buildTime);
    this.contexts.push(context);
    return context;
  }

  runIn<T>(context: SimContext | undefined, fn: () => T): T | undefined {
    if (context && !context.alive) return undefined;
    try {
      const result = context ? RUNNING_CONTEXT.run(context, fn) : fn();
      if (result instanceof Promise)
        fireAndForget(this.watch(result), 'handover-checker');
      return result;
    } catch (error) {
      this.uncaught.push(error);
      return undefined;
    }
  }

  /** Starts `work` in a context, for an entry point that is async itself. */
  start(context: SimContext, work: () => Promise<unknown>): void {
    this.runIn(context, () => {
      fireAndForget(this.watch(work()), 'handover-checker');
    });
  }

  private async watch(work: Promise<unknown>): Promise<void> {
    try {
      await work;
    } catch (error) {
      this.uncaught.push(error);
    }
  }

  enqueue(delivery: Omit<Delivery, 'seq' | 'sender'>): void {
    const sender = this.current();
    if (sender && !sender.alive) return;
    this.seq += 1;
    this.deliveries.push({ ...delivery, seq: this.seq, sender });
  }

  task(context: SimContext | undefined, label: string, fn: () => void): void {
    this.tasks.push({ context, fn, label });
  }

  setTimeout(fn: () => void, ms = 0, interval?: number): number {
    const id = this.timerIds++;
    const context = this.current();
    if (context && !context.alive) return id;
    this.seq += 1;
    this.timers.set(id, {
      id,
      at: this.now + Math.max(0, ms),
      seq: this.seq,
      context,
      fn,
      interval,
      label: `${context?.id ?? 'root'}:${ms}ms`,
    });
    return id;
  }

  clearTimeout(id: unknown): void {
    if (typeof id === 'number') this.timers.delete(id);
  }

  /** Ends a context the way a browser does: locks, ports and timers go. */
  kill(context: SimContext): void {
    if (!context.alive) return;
    context.alive = false;
    this.locks.dropContext(context);
    for (const [id, timer] of this.timers)
      if (timer.context === context) this.timers.delete(id);
    for (const child of this.contexts)
      if (child.parent === context) this.kill(child);
  }

  /** Runs microtasks, zero-delay timers and lock grants until all are done. */
  async settle(): Promise<void> {
    for (let round = 0; round < 100_000; round += 1) {
      await new Promise<void>((resolve) => nativeSetImmediate(resolve));
      const task = this.tasks.shift();
      if (task) {
        this.runIn(task.context, task.fn);
        continue;
      }
      const due = this.dueZeroTimer();
      if (due) {
        this.fire(due);
        continue;
      }
      return;
    }
    throw new Error('the simulation never became quiet');
  }

  private dueZeroTimer(): Timer | undefined {
    let best: Timer | undefined;
    for (const timer of this.timers.values()) {
      if (timer.at > this.now || timer.context?.frozen) continue;
      if (!best || timer.seq < best.seq) best = timer;
    }
    return best;
  }

  private fire(timer: Timer): void {
    if (timer.interval !== undefined) {
      this.seq += 1;
      timer.at = this.now + Math.max(1, timer.interval);
      timer.seq = this.seq;
    } else {
      this.timers.delete(timer.id);
    }
    this.runIn(timer.context, timer.fn);
  }

  /** Deliveries that would run code now, oldest first, one per channel. */
  channels(): Delivery[] {
    const heads = new Map<string, Delivery>();
    for (const delivery of this.deliveries) {
      if (heads.has(delivery.channel)) continue;
      heads.set(delivery.channel, delivery);
    }
    return [...heads.values()]
      .filter((delivery) => !this.heldBack(delivery))
      .sort((a, b) => a.seq - b.seq);
  }

  private heldBack(delivery: Delivery): boolean {
    const target = delivery.target;
    return target instanceof SimPort
      ? !target.started || target.receiverFrozen()
      : target.context?.frozen === true;
  }

  /** Drops deliveries nobody can receive any more. */
  prune(): void {
    for (let index = this.deliveries.length - 1; index >= 0; index -= 1) {
      const delivery = this.deliveries[index];
      if (!delivery) continue;
      const target = delivery.target;
      const dead =
        target instanceof SimPort
          ? !target.receiverAlive()
          : target.closed || target.context?.alive === false;
      if (dead) this.deliveries.splice(index, 1);
    }
  }

  async deliver(delivery: Delivery): Promise<void> {
    const index = this.deliveries.indexOf(delivery);
    if (index >= 0) this.deliveries.splice(index, 1);
    if (delivery.target instanceof SimPort)
      delivery.target.receive(delivery.data, delivery.ports);
    else delivery.target.receive(delivery.data);
    await this.settle();
  }

  nextTimer(): Timer | undefined {
    let best: Timer | undefined;
    for (const timer of this.timers.values()) {
      if (timer.context?.frozen) continue;
      if (
        !best ||
        timer.at < best.at ||
        (timer.at === best.at && timer.seq < best.seq)
      )
        best = timer;
    }
    return best;
  }

  async advance(timer: Timer): Promise<void> {
    this.now = Math.max(this.now, timer.at);
    this.fire(timer);
    await this.settle();
  }

  /** Which timers are armed (context and delay, not time left), for state
   * signatures: a pending timeout is state, how far along it is is not. */
  timerSummary(): string {
    return [
      ...new Set(
        [...this.timers.values()]
          .filter((timer) => timer.context?.alive !== false)
          .map((timer) => timer.label)
      ),
    ]
      .sort()
      .join(',');
  }
}

const PLAIN = new Set(['object', 'number', 'string', 'undefined', 'boolean']);

/** What a message is, for schedules and state signatures. */
export function summarize(data: unknown, depth = 0): string {
  if (depth > 4 || !data || typeof data !== 'object') return typeof data;
  const value = data as Record<string, unknown>;
  if (typeof value.kind === 'string') return value.kind;
  if ('id' in value && 'ok' in value)
    return value.ok
      ? 'response'
      : `refusal:${String(value.errorCode ?? 'untyped')}`;
  const inner = Object.values(value)
    .map((item) => summarize(item, depth + 1))
    .find((summary) => !PLAIN.has(summary));
  if (inner !== undefined) return inner;
  if (!Array.isArray(data)) return 'object';
  return data.length <= 1 ? `frame:${String(data[0])}` : 'frame';
}

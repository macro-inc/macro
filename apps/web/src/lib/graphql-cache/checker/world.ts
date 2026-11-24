/**
 * One run of the handover checker: real pages, coordinators and engine
 * runtimes wired over the deterministic browser in `sim.ts`.
 *
 * Real code under test: `createWorkerCacheHost`, `createRetirableCacheHost`,
 * `CacheCoordinatorPageAdapter`, `installCacheCoordinatorWorker`,
 * `CoordinatorRouter` (with `CoordinatorCore` and `CoordinatorHandoff`),
 * `installCacheEngineWorker` and `createCacheRecovery`. Stand-ins: the WASM
 * engine (`fake-engine.ts`), and `Page`, which repeats how `graphql-soup.ts`
 * builds, retires and restarts its host (that module also builds the urql
 * client, WebSocket and auth, which the handover does not depend on).
 */

import { createHash } from 'node:crypto';
import { fireAndForget } from '@core/util/fireAndForget';
import { match } from 'ts-pattern';
import { vi } from 'vitest';
import {
  CacheRecoverySupersededError,
  createCacheRecovery,
} from '../../service-clients/service-storage/cache-recovery';
import { createRetirableCacheHost } from '../host/retirable-host';
import type { CacheHost } from '../host/types';
import { createWorkerCacheHost } from '../host/worker-host';
import { getOrCreateCacheScope } from '../scope';
import { installCacheCoordinatorWorker } from '../worker/cache-coordinator-runtime';
import { installCacheEngineWorker } from '../worker/cache-engine-runtime';
import { databaseOwnerLockName } from '../worker/coordinator-protocol';
import { CoordinatorRouter } from '../worker/coordinator-router';
import {
  DRAFT_MUTATION,
  DurableStorage,
  draftVariables,
  FakeEngineCore,
} from './fake-engine';
import {
  Sim,
  SimBroadcastChannel,
  type SimContext,
  SimMessageChannel,
  type SimPort,
  type Step,
  summarize,
  type Timer,
} from './sim';

const NOOP_TELEMETRY = { record() {}, flush() {} };

/** What a page asked of its cache and how each request ended. */
export type CallOutcome = {
  page: string;
  kind: 'read' | 'draft';
  uuid?: string;
  /** Made by the quiet phase, to see whether the cache is back. */
  probe?: boolean;
  issuedAt: number;
  settledAt?: number;
  result?: 'ok' | 'error';
  error?: unknown;
  /** The page had ended, or its session had, by the time it settled. */
  moot?: boolean;
};

/** Each time a page dropped its host and went to the network. */
export type Retirement = { page: string; at: number; error: unknown };

let active: World | undefined;
let plant: (() => void) | undefined;

/** Runs after each world is installed, to break the code under test. */
export function usePlant(next: (() => void) | undefined): void {
  plant = next;
}

/** The build of whatever context is running, for the mocked `APP_BUILD_TIME`. */
export function currentBuildTime(): number {
  const context = active?.sim.current();
  return context?.buildTime ?? active?.defaultBuild ?? 0;
}

const DOCUMENT_STATE = ['visibilityState', 'hidden'] as const;

/** Remembers what a world overrides for real; call the result to put it back. */
function takeDocument(): () => void {
  const overrides = DOCUMENT_STATE.map(
    (name) => [name, Object.getOwnPropertyDescriptor(document, name)] as const
  );
  const stored = Array.from({ length: localStorage.length }, (_, index) => {
    const key = localStorage.key(index) ?? '';
    return [key, localStorage.getItem(key) ?? ''] as const;
  });
  return () => {
    for (const [name, descriptor] of overrides) {
      if (descriptor) Object.defineProperty(document, name, descriptor);
      else Reflect.deleteProperty(document, name);
    }
    localStorage.clear();
    for (const [key, value] of stored) localStorage.setItem(key, value);
  };
}

class Coordinator {
  context: SimContext;
  router: CoordinatorRouter;
  /** Page-side ports of every connected page, for a restart. */
  readonly pagePorts: SimPort[] = [];

  constructor(
    private readonly world: World,
    readonly buildTime: number
  ) {
    this.context = this.boot();
    this.router = this.world.sim.runIn(this.context, () =>
      this.createRouter()
    ) as CoordinatorRouter;
  }

  private boot(): SimContext {
    return this.world.sim.context(
      this.world.sim.nextId(`coordinator-${this.buildTime}-`),
      'coordinator',
      undefined,
      this.buildTime
    );
  }

  private createRouter(): CoordinatorRouter {
    return new CoordinatorRouter({ telemetry: NOOP_TELEMETRY });
  }

  connect(): SimPort {
    const channel = new SimMessageChannel(this.world.sim);
    this.install(channel.port2);
    this.pagePorts.push(channel.port1);
    return channel.port1;
  }

  private install(endpoint: SimPort): void {
    this.world.sim.runIn(this.context, () =>
      installCacheCoordinatorWorker({
        endpoint: endpoint as unknown as MessagePort,
        router: this.router,
      })
    );
  }

  /** Safari reconnects live page ports to a fresh, empty worker global. */
  restart(): void {
    this.world.sim.kill(this.context);
    this.context = this.boot();
    this.router = this.world.sim.runIn(this.context, () =>
      this.createRouter()
    ) as CoordinatorRouter;
    for (const pagePort of this.pagePorts) {
      if (pagePort.closed) continue;
      pagePort.peer?.close();
      const channel = new SimMessageChannel(this.world.sim);
      const endpoint = channel.port2;
      endpoint.peer = pagePort;
      pagePort.peer = endpoint;
      this.install(endpoint);
    }
  }

  private core(): { scope?: string; stateValue?: unknown } | undefined {
    return (
      this.router as unknown as {
        core?: { scope?: string; stateValue?: unknown };
      }
    ).core;
  }

  /** The scope it serves, once a page registered. */
  scope(): string | undefined {
    return this.core()?.scope;
  }

  coreState(): string {
    const core = this.core();
    const state = core?.stateValue as
      | { kind: string; ownerEpoch?: number; tabId?: string }
      | undefined;
    if (!state) return 'none';
    const handoff = (
      this.router as unknown as {
        handoff?: { active?: unknown; current?: unknown; parked?: boolean };
      }
    ).handoff;
    const handoffState = handoff
      ? `h${handoff.active ? 'A' : ''}${handoff.current === undefined ? '' : 'C'}${handoff.parked ? 'P' : ''}`
      : '';
    return `${state.kind}${state.ownerEpoch === undefined ? '' : `@${state.ownerEpoch}`}${state.tabId ? `:${state.tabId}` : ''}/${handoffState}`;
  }
}

class EngineWorker {
  onerror: ((this: AbstractWorker, event: ErrorEvent) => unknown) | null = null;
  onmessageerror: ((this: Worker, event: MessageEvent) => unknown) | null =
    null;
  readonly context: SimContext;
  private readonly pagePort: SimPort;
  core: FakeEngineCore | undefined;

  constructor(
    private readonly world: World,
    page: SimContext,
    epoch: number
  ) {
    this.context = world.sim.context(
      world.sim.nextId(`engine-${page.id}-${epoch}-`),
      'engine',
      page,
      page.buildTime
    );
    const channel = new SimMessageChannel(world.sim);
    this.pagePort = channel.port1;
    const scope = channel.port2;
    // `self.close()` ends the worker once its current task is done.
    scope.onClose = () =>
      world.sim.task(undefined, 'worker-closed', () => this.terminate());
    world.sim.runIn(this.context, () =>
      installCacheEngineWorker({
        scope: scope as unknown as {
          onmessage: ((event: MessageEvent<unknown>) => void) | null;
          close(): void;
        },
        createCore: (options) => {
          this.core = new FakeEngineCore(
            world.sim,
            world.storage,
            this.context,
            options
          );
          return this.core;
        },
        telemetry: NOOP_TELEMETRY,
      })
    );
    world.engines.push(this);
  }

  postMessage(message: unknown, transfer: Transferable[]): void {
    this.pagePort.postMessage(message, transfer);
  }

  /** Ended by its page, by itself, or by a crash nobody is told about. */
  terminate(): void {
    this.core?.terminated();
    this.world.sim.kill(this.context);
  }
}

/**
 * A page as `graphql-soup.ts` runs its cache: a retirable host, a network
 * fallback when it fails, and `createCacheRecovery` restarting it.
 */
export class Page {
  host: CacheHost | undefined;
  closing = false;
  inBfcache = false;
  cacheOff = false;
  readonly recovery: ReturnType<typeof createCacheRecovery>;
  stops: string[] = [];
  /** Goes up each time the page's session ends. */
  session = 0;

  constructor(
    private readonly world: World,
    readonly context: SimContext
  ) {
    this.recovery = createCacheRecovery(() => this.restartCache(), {
      onStopped: (reason) => {
        this.stops.push(reason);
      },
    });
  }

  get id(): string {
    return this.context.id;
  }

  private buildHost(): CacheHost {
    let host: CacheHost | undefined;
    const onInitializationError = (error: Error) => {
      if (!host || this.host !== host) return;
      this.fallback(error);
    };
    host = createRetirableCacheHost(
      createWorkerCacheHost({
        scope: getOrCreateCacheScope(),
        onInitializationError,
        telemetry: NOOP_TELEMETRY,
        onSuperseded: () => {
          this.world.reloadRequests.push(this.id);
        },
      })
    );
    return host;
  }

  /** `getGraphqlSoupClient`: build the cached client if there is none. */
  client(): CacheHost | undefined {
    if (this.host) return this.host;
    this.host = this.buildHost();
    this.cacheOff = this.recovery.state() === 'recovering';
    return this.host;
  }

  /** `initializeGraphqlSoupCache`: wait for the handshake at startup. */
  async start(): Promise<void> {
    this.client();
    const host = this.host;
    try {
      await host?.authority?.current();
    } catch (error) {
      if (host && this.host === host) this.fallback(error);
    }
  }

  /** The app at work: a draft and a read. */
  work(probe = false): void {
    this.draft(probe);
    this.read(probe);
  }

  /** `setGraphqlSoupSessionActive(true)`: the client is built again, and
   * nothing but the host itself reports a failed start. */
  private async signIn(): Promise<void> {
    this.client();
    const authority = this.host?.authority;
    this.work();
    try {
      await authority?.current();
    } catch {
      // `initializeCrmCacheOwner` has no fallback of its own.
    }
  }

  /** `fallbackAfterInitializationFailure`. */
  fallback(error: unknown): void {
    const host = this.host;
    this.host = undefined;
    this.cacheOff = true;
    if (!this.closing)
      this.world.retirements.push({
        page: this.id,
        at: this.world.sim.now,
        error,
      });
    host?.dispose();
    this.recovery.failed(error);
  }

  /** `restartCache`. */
  private async restartCache(): Promise<void> {
    if (!this.host || this.host.disabled) this.client();
    const host = this.host;
    if (!host || host.disabled)
      throw new Error('Local cache could not restart.');
    await host.currentRevision();
    await host.inspectMutations?.();
    if (host !== this.host || host.disabled)
      throw new CacheRecoverySupersededError();
    this.cacheOff = false;
  }

  read(probe = false): void {
    const host = this.host;
    if (!host || host.disabled) return;
    const call: CallOutcome = {
      page: this.id,
      kind: 'read',
      issuedAt: this.world.sim.now,
      ...(probe ? { probe } : {}),
    };
    this.world.calls.push(call);
    this.track(call, () =>
      host.readQuery({ query: 'query Viewer { user { id } }' })
    );
  }

  draft(probe = false): void {
    const host = this.host;
    if (!host || host.disabled) return;
    const uuid = this.world.sim.randomUUID();
    const call: CallOutcome = {
      page: this.id,
      kind: 'draft',
      uuid,
      issuedAt: this.world.sim.now,
      ...(probe ? { probe } : {}),
    };
    this.world.calls.push(call);
    this.track(call, () =>
      host.enqueueOptimisticMutation(
        {
          uuid,
          query: DRAFT_MUTATION,
          variables: draftVariables(uuid),
          data: {
            saveEmailDraft: {
              __typename: 'SaveEmailDraftPayload',
              draftId: uuid,
            },
          },
          generation: '00000000-0000-4000-8000-000000000098',
        },
        { owner: this.id, nowMs: this.world.sim.now, leaseExpiresAtMs: 0 }
      )
    );
  }

  private track(call: CallOutcome, request: () => Promise<unknown>): void {
    fireAndForget(this.settle(call, request), 'handover-checker');
  }

  private async settle(
    call: CallOutcome,
    request: () => Promise<unknown>
  ): Promise<void> {
    const session = this.session;
    try {
      await request();
      call.result = 'ok';
    } catch (error) {
      call.result = 'error';
      call.error = error;
    }
    call.settledAt = this.world.sim.now;
    call.moot = this.closing || session !== this.session;
  }

  setVisibility(state: DocumentVisibilityState): void {
    if (this.context.visibilityState === state) return;
    this.context.visibilityState = state;
    this.world.dispatch(this.context, 'visibilitychange', {});
  }

  setOnline(online: boolean): void {
    if (this.context.onLine === online) return;
    this.context.onLine = online;
    this.world.dispatch(this.context, online ? 'online' : 'offline', {});
  }

  /** The page navigates away or closes. */
  close(): void {
    this.closing = true;
    this.world.dispatch(this.context, 'pagehide', { persisted: false });
  }

  enterBfcache(): void {
    this.inBfcache = true;
    this.world.dispatch(this.context, 'pagehide', { persisted: true });
    this.setVisibility('hidden');
  }

  leaveBfcache(): void {
    this.inBfcache = false;
    this.world.dispatch(this.context, 'pageshow', { persisted: true });
    this.setVisibility('visible');
  }

  /** The session ends (`disposeSessionClients`), and is back a second later. */
  expireSession(): void {
    this.session += 1;
    this.recovery.reset();
    this.stops = [];
    this.cacheOff = false;
    const host = this.host;
    this.host = undefined;
    host?.dispose();
    this.world.sim.setTimeout(() => {
      fireAndForget(this.signIn(), 'handover-checker');
    }, 1_000);
  }
}

/**
 * What can happen to the origin. `close` runs the page's `pagehide`; `kill`
 * ends it with no event, as a crash or a discarded tab does. `crash-engine`
 * ends a page's engine worker and tells nobody. `bfcache` navigates away with
 * the page kept, frozen, and `restore` comes back to it. `expire-session` signs
 * a page out for a second. `hold-owner-lock` has another context keep the
 * database's lock for 5 s, `hold-files` has one keep its files open for 15 s
 * without the lock (as a terminated worker does while the browser closes
 * them), and `fail-open` makes the next open of the database fail.
 * `require-reset` has a page's engine find its open database broken, and
 * `fail-assets` and `stall-assets` fail the next engine's load or leave it
 * hanging.
 */
export type FaultKind =
  | 'hide'
  | 'show'
  | 'close'
  | 'kill'
  | 'crash-engine'
  | 'restart-coordinator'
  | 'freeze'
  | 'thaw'
  | 'expire-session'
  | 'offline'
  | 'online'
  | 'hold-owner-lock'
  | 'hold-files'
  | 'open-newer'
  | 'bfcache'
  | 'restore'
  | 'fail-open'
  | 'require-reset'
  | 'fail-assets'
  | 'stall-assets';

export type Fault = { kind: FaultKind; page?: string };

/** A fault as violations name it: what it was, and whether it hit a page with
 * an engine. */
export type InjectedFault = FaultKind | `${FaultKind} owner` | 'late-message';

export type Scenario = {
  name: string;
  /** Build time of each page opened at the start, in order. */
  pages: number[];
  /** The kinds of fault that may be injected. */
  faults: FaultKind[];
  /** Fault-phase length in virtual ms. */
  horizonMs: number;
  /** Whether a message can be held back until a timer has fired. */
  late?: boolean;
};

type Option = {
  label: string;
  run: () => Promise<void>;
  /** Whether it counts against the bound's delays. */
  delay: boolean;
  /** The timer it fires. */
  timer?: Timer;
  /** Whether it delivers out of order. */
  reorders?: boolean;
};

export class World {
  readonly sim = new Sim();
  readonly storage = new DurableStorage();
  readonly pages: Page[] = [];
  /** By SharedWorker name, which has the scope and the build in it. */
  readonly coordinators = new Map<string, Coordinator>();
  readonly engines: EngineWorker[] = [];
  readonly calls: CallOutcome[] = [];
  readonly retirements: Retirement[] = [];
  readonly reloadRequests: string[] = [];
  /** What the code under test wrote to the console, kept off the test log. */
  readonly consoleLines: string[] = [];
  readonly steps: Step[] = [];
  readonly defaultBuild: number;
  /** Undoes what `install` did to the document and its storage. */
  private restore: (() => void) | undefined;
  private readonly pageListeners = new Map<
    SimContext,
    Map<string, Set<EventListenerOrEventListenerObject>>
  >();
  private holderRelease: (() => void) | undefined;
  private openedNewer = false;
  /** Set once faults stop; what is applied after that is the quiet phase. */
  quiet = false;
  /** The faults injected before the quiet phase, in order. */
  readonly injected: InjectedFault[] = [];
  /** Deliveries made out of order before the quiet phase. */
  reordered = 0;

  constructor(readonly scenario: Scenario) {
    this.defaultBuild = scenario.pages[0] ?? 1;
  }

  install(): void {
    active = this;
    const sim = this.sim;
    this.restore = takeDocument();
    localStorage.clear();
    vi.stubGlobal(
      'setTimeout',
      (fn: () => void, ms?: number, ...args: unknown[]) =>
        sim.setTimeout(() => fn(...(args as [])), ms ?? 0)
    );
    vi.stubGlobal('clearTimeout', (id: unknown) => sim.clearTimeout(id));
    vi.stubGlobal('setInterval', (fn: () => void, ms?: number) =>
      sim.setTimeout(fn, ms ?? 0, ms ?? 0)
    );
    vi.stubGlobal('clearInterval', (id: unknown) => sim.clearTimeout(id));
    vi.spyOn(performance, 'now').mockImplementation(() => sim.now);
    vi.spyOn(Date, 'now').mockImplementation(() => sim.now);
    vi.spyOn(Math, 'random').mockImplementation(() => 0.5);
    for (const level of ['error', 'warn', 'info', 'debug'] as const)
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        this.consoleLines.push(
          `${level}: ${args.map(String).join(' ').slice(0, 200)}`
        );
      });
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => sim.randomUUID());
    vi.stubGlobal(
      'MessageChannel',
      class {
        readonly port1: SimPort;
        readonly port2: SimPort;
        constructor() {
          const channel = new SimMessageChannel(sim);
          this.port1 = channel.port1;
          this.port2 = channel.port2;
        }
      }
    );
    vi.stubGlobal(
      'BroadcastChannel',
      class extends SimBroadcastChannel {
        constructor(name: string) {
          super(sim, name);
        }
      }
    );
    const world = this;
    vi.stubGlobal(
      'SharedWorker',
      class {
        onerror: ((event: unknown) => unknown) | null = null;
        readonly port: SimPort;
        constructor(_url: URL, options?: WorkerOptions) {
          this.port = world
            .coordinator(options?.name ?? '', currentBuildTime())
            .connect();
        }
      }
    );
    vi.stubGlobal(
      'Worker',
      class {
        readonly delegate: EngineWorker;
        constructor(_url: URL, options?: WorkerOptions) {
          const page = sim.current();
          if (!page) throw new Error('a worker was created outside any page');
          const epoch = Number(options?.name?.split(':').at(-1));
          this.delegate = new EngineWorker(world, page, epoch);
        }
        get onerror() {
          return this.delegate.onerror;
        }
        set onerror(value) {
          this.delegate.onerror = value;
        }
        get onmessageerror() {
          return this.delegate.onmessageerror;
        }
        set onmessageerror(value) {
          this.delegate.onmessageerror = value;
        }
        postMessage(message: unknown, transfer: Transferable[]): void {
          this.delegate.postMessage(message, transfer);
        }
        terminate(): void {
          this.delegate.terminate();
        }
      }
    );
    const pageOf = () => {
      let context = sim.current();
      while (context?.parent) context = context.parent;
      return context;
    };
    vi.stubGlobal('navigator', {
      locks: sim.locks,
      get onLine() {
        return pageOf()?.onLine ?? true;
      },
      storage: {
        getDirectory: async () => ({
          async *keys() {},
          async *entries() {},
          async *values() {},
        }),
      },
      userAgent: 'handover-checker',
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => pageOf()?.visibilityState ?? 'visible',
    });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => (pageOf()?.visibilityState ?? 'visible') === 'hidden',
    });
    const routed = new Set([
      'visibilitychange',
      'pagehide',
      'pageshow',
      'online',
      'offline',
    ]);
    for (const target of new Set<EventTarget>([
      window,
      document,
      globalThis as unknown as EventTarget,
    ])) {
      const add = target.addEventListener.bind(target);
      const remove = target.removeEventListener.bind(target);
      vi.spyOn(target, 'addEventListener').mockImplementation(
        (type, listener, options) => {
          const page = pageOf();
          if (!routed.has(type) || !page || !listener)
            return add(type, listener, options);
          this.listenersOf(page, type).add(listener);
        }
      );
      vi.spyOn(target, 'removeEventListener').mockImplementation(
        (type, listener, options) => {
          const page = pageOf();
          if (!routed.has(type) || !page || !listener)
            return remove(type, listener, options);
          this.listenersOf(page, type).delete(listener);
        }
      );
    }
    plant?.();
  }

  uninstall(): void {
    if (active === this) active = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    this.restore?.();
    this.restore = undefined;
  }

  private listenersOf(page: SimContext, type: string) {
    let byType = this.pageListeners.get(page);
    if (!byType) {
      byType = new Map();
      this.pageListeners.set(page, byType);
    }
    let listeners = byType.get(type);
    if (!listeners) {
      listeners = new Set();
      byType.set(type, listeners);
    }
    return listeners;
  }

  dispatch(page: SimContext, type: string, init: Record<string, unknown>) {
    const event = { type, ...init };
    for (const listener of [...this.listenersOf(page, type)]) {
      this.sim.runIn(page, () =>
        typeof listener === 'function'
          ? listener(event as unknown as Event)
          : listener.handleEvent(event as unknown as Event)
      );
    }
  }

  coordinator(name: string, buildTime: number): Coordinator {
    let coordinator = this.coordinators.get(name);
    if (!coordinator) {
      coordinator = new Coordinator(this, buildTime);
      this.coordinators.set(name, coordinator);
    }
    return coordinator;
  }

  async openPage(buildTime: number): Promise<Page> {
    const page = this.addPage(buildTime);
    this.sim.start(page.context, () => page.start());
    await this.sim.settle();
    return page;
  }

  private addPage(buildTime: number): Page {
    const context = this.sim.context(
      `tab${this.pages.length + 1}`,
      'page',
      undefined,
      buildTime
    );
    const page = this.sim.runIn(context, () => new Page(this, context)) as Page;
    this.pages.push(page);
    return page;
  }

  livePages(): Page[] {
    return this.pages.filter((page) => page.context.alive);
  }

  /** The faults that can happen now, in a fixed order. */
  faults(): Fault[] {
    const faults: Fault[] = [];
    for (const kind of this.scenario.faults) {
      if (kind === 'restart-coordinator') {
        if (this.coordinators.size > 0) faults.push({ kind });
        continue;
      }
      if (kind === 'fail-open') {
        if (this.storage.failNextOpens === 0) faults.push({ kind });
        continue;
      }
      if (kind === 'fail-assets' || kind === 'stall-assets') {
        if (this.storage.nextAssets === 'load') faults.push({ kind });
        continue;
      }
      if (kind === 'hold-owner-lock') {
        if (!this.holderRelease) faults.push({ kind });
        continue;
      }
      if (kind === 'hold-files') {
        if (this.storage.filesFreed.size === 0) faults.push({ kind });
        continue;
      }
      if (kind === 'open-newer') {
        if (!this.openedNewer) faults.push({ kind });
        continue;
      }
      for (const page of this.livePages()) {
        if (this.applies(kind, page)) faults.push({ kind, page: page.id });
      }
    }
    return faults;
  }

  private applies(kind: FaultKind, page: Page): boolean {
    const context = page.context;
    const visible = context.visibilityState === 'visible';
    return (
      match(kind)
        .with('hide', 'bfcache', () => visible && !page.closing)
        .with('show', () => !visible && !context.frozen)
        // Browsers freeze background pages, never a visible one.
        .with('freeze', () => !visible && !context.frozen)
        .with('thaw', () => context.frozen && !page.inBfcache)
        .with('restore', () => page.inBfcache)
        .with('offline', () => context.onLine)
        .with('online', () => !context.onLine)
        .with('crash-engine', () => this.enginesOf(page).length > 0)
        .with('require-reset', () => this.servingEnginesOf(page).length > 0)
        .with('close', () => !context.frozen)
        .with('kill', () => true)
        .with(
          'expire-session',
          () => page.host !== undefined && !context.frozen && !page.closing
        )
        .with(
          'restart-coordinator',
          'hold-owner-lock',
          'hold-files',
          'open-newer',
          'fail-open',
          'fail-assets',
          'stall-assets',
          () => false
        )
        .exhaustive()
    );
  }

  private enginesOf(page: Page): EngineWorker[] {
    return this.engines.filter(
      (engine) => engine.context.parent === page.context && engine.context.alive
    );
  }

  /** Those with a database open, and running. */
  private servingEnginesOf(page: Page): EngineWorker[] {
    return this.enginesOf(page).filter(
      ({ context, core }) => !context.frozen && core?.serving !== undefined
    );
  }

  async apply(fault: Fault): Promise<void> {
    this.steps.push({
      kind: 'fault',
      fault: `${fault.kind}${fault.page ? `:${fault.page}` : ''}`,
    });
    const page = this.pages.find((candidate) => candidate.id === fault.page);
    const owner = page !== undefined && this.enginesOf(page).length > 0;
    if (!this.quiet)
      this.injected.push(owner ? `${fault.kind} owner` : fault.kind);
    page?.context.note(fault.kind);
    if (
      page &&
      (fault.kind === 'crash-engine' || fault.kind === 'require-reset')
    )
      for (const engine of this.enginesOf(page))
        engine.context.note(fault.kind);
    if (page) await this.applyToPage(fault.kind, page);
    else this.applyToOrigin(fault.kind);
    this.sim.prune();
    await this.sim.settle();
  }

  private applyToOrigin(kind: FaultKind): void {
    match(kind)
      .with('restart-coordinator', () => {
        for (const coordinator of this.coordinators.values())
          coordinator.restart();
      })
      .with('hold-owner-lock', () => this.holdOwnerLock())
      .with('hold-files', () => this.holdFiles())
      .with('open-newer', () => this.openNewer())
      .with('fail-open', () => {
        this.storage.failNextOpens += 1;
      })
      .with('fail-assets', () => {
        this.storage.nextAssets = 'fail';
      })
      .with('stall-assets', () => {
        this.storage.nextAssets = 'stall';
      })
      .otherwise((other) => {
        throw new Error(`${other} needs a page`);
      });
  }

  private async applyToPage(kind: FaultKind, page: Page): Promise<void> {
    const inPage = (fn: () => void) => this.sim.runIn(page.context, fn);
    const setFrozen = (frozen: boolean) => {
      page.context.frozen = frozen;
      for (const engine of this.enginesOf(page)) engine.context.frozen = frozen;
    };
    await match(kind)
      .with('hide', () => inPage(() => page.setVisibility('hidden')))
      .with('show', () => inPage(() => page.setVisibility('visible')))
      .with('offline', () => inPage(() => page.setOnline(false)))
      .with('online', () => inPage(() => page.setOnline(true)))
      .with('freeze', () => setFrozen(true))
      .with('thaw', () => setFrozen(false))
      .with('bfcache', async () => {
        inPage(() => page.enterBfcache());
        await this.sim.settle();
        setFrozen(true);
      })
      .with('restore', () => {
        setFrozen(false);
        inPage(() => page.leaveBfcache());
      })
      .with('crash-engine', () => {
        for (const engine of this.enginesOf(page)) engine.terminate();
      })
      .with('require-reset', () => {
        for (const { context, core } of this.servingEnginesOf(page))
          this.sim.runIn(context, () => core?.requireReset());
      })
      .with('close', async () => {
        inPage(() => page.close());
        await this.sim.settle();
        this.endPage(page);
      })
      .with('kill', () => {
        page.closing = true;
        this.endPage(page);
      })
      .with('expire-session', () => inPage(() => page.expireSession()))
      .otherwise((other) => {
        throw new Error(`${other} is not a page fault`);
      });
  }

  private endPage(page: Page): void {
    for (const engine of this.enginesOf(page)) engine.terminate();
    this.sim.kill(page.context);
  }

  /** A page of a build newer than every open one. */
  private openNewer(): void {
    this.openedNewer = true;
    const newest = Math.max(
      ...this.pages.map((open) => open.context.buildTime)
    );
    const page = this.addPage(newest + 1);
    this.sim.start(page.context, () => page.start());
    this.sim.runIn(page.context, () => page.work());
  }

  private holdFiles(): void {
    const holder = this.sim.context('file-holder', 'holder', undefined, 0);
    const scope = getOrCreateCacheScope();
    const { filesFreed } = this.storage;
    this.sim.runIn(holder, () => {
      const freed = new Promise<void>((free) => {
        this.sim.setTimeout(() => {
          filesFreed.delete(scope);
          free();
        }, 15_000);
      });
      filesFreed.set(scope, freed);
    });
  }

  /** Another context (a closing tab's worker, another build) keeps the lock. */
  private holdOwnerLock(): void {
    const holder = this.sim.context('holder', 'holder', undefined, 0);
    const name = databaseOwnerLockName(getOrCreateCacheScope());
    this.sim.start(holder, () =>
      this.sim.locks.request(
        name,
        { mode: 'exclusive' },
        () =>
          new Promise<void>((release) => {
            this.holderRelease = release;
            this.sim.setTimeout(() => {
              this.holderRelease = undefined;
              release();
            }, 5_000);
          })
      )
    );
  }

  /** What can happen next: first the default, the oldest delivery or else the
   * next timer, then the choices that are delays. */
  options(): Option[] {
    this.sim.prune();
    const heads = this.sim.channels();
    const deliveries = heads.map((delivery, index): Option => {
      const summary = summarize(delivery.data);
      return {
        label: `deliver ${delivery.channel} ${summary}`,
        delay: index > 0,
        reorders: index > 0,
        run: async () => {
          this.steps.push({
            kind: 'deliver',
            channel: delivery.channel,
            summary,
          });
          await this.sim.deliver(delivery);
        },
      };
    });
    const [oldest] = heads;
    if (!oldest) return this.timerOption();
    return [...deliveries, ...this.lateOptions(oldest.channel)];
  }

  private timerOption(): Option[] {
    const timer = this.sim.nextTimer();
    if (!timer) return [];
    return [
      {
        label: `timer ${timer.label}`,
        delay: false,
        timer,
        run: () => this.runTimer(timer),
      },
    ];
  }

  async runTimer(timer: Timer): Promise<void> {
    this.steps.push({ kind: 'timer', label: timer.label, at: timer.at });
    await this.sim.advance(timer);
  }

  private lateOptions(channel: string): Option[] {
    if (!this.scenario.late || this.sim.lateChannel() !== undefined) return [];
    return this.sim.deadlines().map((timer) => ({
      label: `hold ${channel} until ${timer.label}`,
      delay: true,
      run: async () => {
        this.steps.push({ kind: 'hold', channel, label: timer.label });
        this.injected.push('late-message');
        this.sim.holdUntil(channel, timer);
      },
    }));
  }

  /**
   * The state a run is in, for skipping schedules that reach it again: what
   * every context has handled, what is on its way, the locks, the databases
   * and how long each armed timer has to go. Heartbeats a context handled are
   * left out.
   */
  signature(): string {
    const contexts = this.sim.contexts.map(
      (context) =>
        `${context.id}:${context.history}${context.alive ? '' : 'x'}${context.frozen ? 'f' : ''}`
    );
    const storage = [...this.storage.databases].map(
      ([scope, { queue, wipes, openBy }]) =>
        `${scope}:${queue.size}.${wipes}.${openBy ?? ''}`
    );
    const state = [
      contexts.join(),
      this.sim.pending(),
      this.sim.lateChannel(),
      this.sim.locks.summary(),
      storage.join(),
      this.storage.failNextOpens,
      this.storage.nextAssets,
      this.sim.timerSummary(),
    ].join('#');
    return createHash('sha1').update(state).digest('base64');
  }
}

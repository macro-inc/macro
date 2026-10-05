/**
 * One live agent session: the fold machine, the realtime rows that feed it,
 * and the REST calls that act on it, behind one object with one event stream.
 *
 * Framework-free. A surface acquires the session for the ids it shows and
 * releases it on unmount; every surface showing the same session shares one
 * instance, so the log is fetched once, folded once, and speculated once.
 *
 * Speculation lives in the machine, not here. `issue` folds an action the
 * moment it is sent and the machine promotes it when the log confirms it,
 * rebases it when a foreign row lands first, and drops it if this class
 * retracts it. Listeners only ever see fold events; whether a message is
 * still on the wire is a field on the message, never a second channel.
 *
 * A session opened before is folded twice: first from the raw log this
 * browser cached at its last open, so the surface has a transcript while
 * the fetch is on the wire, then from the fetched log, which the machine
 * reconciles by row id. The fetched log is then what the cache holds, with
 * every row the socket delivers after it appended.
 */

import {
  closeSession,
  type FoldInput,
  pushSession,
  readSession,
  type SessionFoldSnapshot,
} from '@core/agent-fold/client';
import { fetchAgentSessionLog } from '@queries/agent-session/log';
import { agentSessionLogCache } from '@queries/agent-session/log-cache';
import { subscribeSocketSessionStarted } from '@queries/agent-session/queue-sync';
import type { AgentSessionLogEvent } from '@queries/agent-session/realtime-protocol';
import { subscribeAgentSessionUpdated } from '@queries/agent-session/session-metadata-sync';
import type {
  FoldedStreamEvent,
  TurnState,
} from '@service-agent-fold/generated/types';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type {
  AgentAction,
  AgentSessionLogEntryDto,
  AgentSessionResponse,
  ControlRequest,
  SessionBot,
} from '@service-agent-harness/generated/schemas';
import { v7 as uuidv7 } from 'uuid';
import {
  SessionLoadTrace,
  traceAcquire,
  traceCacheWrite,
} from './load-telemetry';
import { publishSessionTurn } from './session-turn';

export type AgentSessionListener = (events: FoldedStreamEvent[]) => void;

/** The session row and the bot it runs as, once the load resolved. */
export type AgentSessionRecord = {
  session: AgentSessionResponse;
  bot: SessionBot;
};

export type IssueResult = Awaited<
  ReturnType<typeof agentHarnessServiceClient.control>
>;

/**
 * The load was abandoned because every surface holding the session let go
 * before it finished.
 *
 * Its own type because it is not a fault: a row that scrolls out of the list
 * mid-fetch is ordinary, and a caller that cannot tell it apart from a failed
 * fetch either reports a phantom error or hides a real one.
 */
export class AgentSessionReleased extends Error {
  constructor(readonly sessionId: string) {
    super(`agent session released: ${sessionId}`);
    this.name = 'AgentSessionReleased';
  }
}

/**
 * The harness answered 401/403: the viewer is not a participant of this
 * session. Retrying cannot help, and the surface should say so rather than
 * report a connectivity problem.
 */
export class AgentSessionAccessDenied extends Error {
  constructor(readonly sessionId: string) {
    super(`agent session is not accessible to this user: ${sessionId}`);
    this.name = 'AgentSessionAccessDenied';
  }
}

const accessDenied = (errors: { code: string }[]) =>
  errors.some(
    (error) => error.code === 'UNAUTHORIZED' || error.code === 'FORBIDDEN'
  );

/**
 * Whether this action takes the turn, rather than riding alongside one. ACP
 * runs a prompt at a time, so these are the ones the harness queues; mirrors
 * `AgentAction::occupies_turn` in `agent_runtime_protocol`.
 */
function occupiesTurn(action: AgentAction): boolean {
  return action.type === 'prompt' || action.type === 'compact';
}

const RESYNC_RETRY_DELAYS_MS = [1_000, 3_000, 10_000];

/**
 * How long appended rows wait before the cache is rewritten. A streaming
 * turn delivers rows many times a second, and each write is the whole log.
 */
const CACHE_WRITE_DEBOUNCE_MS = 1_000;

export class AgentSession {
  private static readonly open = new Map<string, AgentSession>();

  /**
   * The shared instance for `id`, created on first acquisition. Every
   * acquisition needs a matching {@link release}; the last one closes the
   * machine and drops the subscriptions.
   */
  static acquire(id: string): AgentSession {
    const open = AgentSession.open.get(id);
    const session = open ?? new AgentSession(id);
    AgentSession.open.set(id, session);
    session.references += 1;
    traceAcquire(id, open === undefined, session.references);
    return session;
  }

  /** The open instance for `id`, for a caller that only wants to act on it. */
  static get(id: string): AgentSession | undefined {
    return AgentSession.open.get(id);
  }

  /**
   * Realtime ingress: a run of persisted rows in log order, addressed by
   * session. The socket dispatch and the replay driver both call this; a
   * session nobody has open ignores it. The run reaches the machine as one
   * push, so a flush of many frames costs one worker round trip.
   */
  static ingest(event: AgentSessionLogEvent): void {
    AgentSession.open
      .get(event.agentSessionId)
      ?.enqueueAll(event.entries.map((row) => ({ kind: 'confirmed', row })));
  }

  readonly id: string;

  private references = 0;
  private closed = false;
  /** The fetched snapshot has been folded; inputs no longer wait for it. */
  private ready = false;
  /**
   * The fetched log has been folded. Before this the machine may hold the
   * cached log, shown but frozen: live rows wait in `buffered` and fold
   * after the fetched snapshot, which cannot have lost them.
   */
  private settled = false;
  /**
   * What the cache holds for this session: the fetched log, with every
   * confirmed row after it appended. Rewritten whole, debounced.
   */
  private cached:
    | {
        session: AgentSessionResponse;
        bot: SessionBot;
        rows: AgentSessionLogEntryDto[];
        rowIds: Set<string>;
      }
    | undefined;
  private cacheWriteTimer?: ReturnType<typeof setTimeout>;
  /** Inputs that arrived before the snapshot, in order. */
  private buffered: FoldInput[] = [];
  private readonly listeners = new Set<AgentSessionListener>();
  private readonly unsubscribeSocket: () => void;
  private readonly unsubscribeUpdated: () => void;
  private syncing = false;
  private resyncRequested = false;
  private resyncRetry = 0;
  private resyncTimer?: ReturnType<typeof setTimeout>;
  /**
   * Serializes worker pushes so inputs reach the machine in the order this
   * class saw them, even though each push is its own await.
   */
  private chain: Promise<void> = Promise.resolve();
  private warming: Promise<AgentSessionRecord | undefined>;
  private loading: Promise<AgentSessionRecord>;
  private loadFailed = false;
  /** The span for the attempt in flight, ended by whatever settles it. */
  private trace: SessionLoadTrace;
  /**
   * The fold's turn state, tracked off the same events listeners see. What
   * {@link issue} reads to know whether an action will reach the runtime or
   * wait in the server's queue.
   */
  private turn: TurnState = 'idle';

  private setTurn(turn: TurnState | undefined): void {
    const next = turn ?? 'idle';
    this.turn = next;
    publishSessionTurn(this.id, next);
  }

  private constructor(id: string) {
    this.id = id;
    // Subscribed before the fetch so no row between the two is lost: rows
    // that arrive during the load are buffered and folded after the snapshot.
    this.unsubscribeSocket = subscribeSocketSessionStarted(() => {
      void this.resync();
    });
    this.unsubscribeUpdated = subscribeAgentSessionUpdated((event) => {
      if (event.agentSessionId === this.id) void this.resync();
    });
    this.trace = new SessionLoadTrace(id);
    this.warming = this.startWarm();
    this.loading = this.startLoad();
    // A surface rendering the cached log has not called `load` yet when a
    // fast failure lands, and an unobserved rejection is reported as
    // unhandled. The failure still reaches every caller of `load`.
    this.loading.catch(() => undefined);
  }

  /**
   * The session as this browser last saw it, folded from the cached log:
   * what a surface can render while {@link load} is on the wire. Resolves
   * to nothing when there is no cached log, or when the fetched one landed
   * first. Never fails: a cache that cannot be read is a cache miss.
   */
  warm(): Promise<AgentSessionRecord | undefined> {
    return this.warming;
  }

  /**
   * The load: the session row and the log, fetched and folded. Resolves to
   * the same record for every caller; a load that failed is re-run by the
   * next call, which is how a surface's Retry works.
   */
  load(): Promise<AgentSessionRecord> {
    if (this.loadFailed) {
      this.loadFailed = false;
      this.trace = new SessionLoadTrace(this.id);
      this.loading = this.startLoad();
    }
    return this.loading;
  }

  /**
   * Do something to the agent. The action is folded before the harness
   * answers, so its effect is visible at once: a prompt as a pending bubble,
   * a stop as a pending Stopped line, a model change as a pending control.
   * The harness's answer settles it: accepted under the same id, the
   * confirmed row promotes it in place; accepted under another id, the
   * speculation is reissued under that one; refused, it is retracted.
   *
   * An action the server will queue rather than run is not speculated at all
   * - see {@link reaches} - so a waiting prompt shows in the queue and
   * nowhere else.
   *
   * `userId` is the caller, so the pending bubble is attributed exactly as
   * the confirmed row will be.
   */
  async issue(
    action: AgentAction,
    options: { userId?: string } = {}
  ): Promise<IssueResult> {
    const actionId = uuidv7();
    const speculated = this.reaches(action);
    if (speculated) {
      // A prompt we just folded opens a turn, so the next one belongs in the
      // queue. Recorded here rather than waited for: `turn` otherwise only
      // moves when the worker answers, and two prompts sent inside that
      // window would both speculate - the second one showing a bubble the
      // server's `queued` then takes away again.
      if (occupiesTurn(action)) this.setTurn('starting');
      void this.enqueue({
        kind: 'speculated',
        actionId,
        action,
        userId: options.userId,
      });
    }

    // The harness adopts the id the client speculated under; the response
    // names the id it was accepted under and `issue` reconciles the two.
    const request: ControlRequest = { ...action, actionId };
    const result = await agentHarnessServiceClient.control(this.id, request);

    if (!speculated) return result;
    if (result.isErr()) {
      void this.enqueue({ kind: 'retracted', actionId });
      return result;
    }
    // Queued after all: the turn opened between the check and the POST. The
    // harness logs the row only when the queue dispatches it, so holding the
    // speculation would show an open turn for the whole wait.
    if (result.value.status === 'queued') {
      void this.enqueue({ kind: 'retracted', actionId });
      return result;
    }
    // A stop is a notification and carries no id on the wire, so the log
    // confirms it by content whatever id the harness accepted it under.
    const accepted = result.value.actionId;
    if (accepted !== actionId && action.type !== 'stop') {
      void this.enqueueAll([
        { kind: 'retracted', actionId },
        {
          kind: 'speculated',
          actionId: accepted,
          action,
          userId: options.userId,
        },
      ]);
    }
    return result;
  }

  /**
   * Show an action the server already holds as if it had dispatched. Nothing
   * is sent: the server queued this action earlier under `actionId`, and the
   * caller has just done the thing that makes it dispatch next - stopped the
   * running turn. The dispatched row arrives under the same id and promotes
   * the speculation in place; `retract` takes it back if the queue says the
   * action is still waiting after all.
   */
  expect(
    actionId: string,
    action: AgentAction,
    options: { userId?: string } = {}
  ): void {
    if (occupiesTurn(action)) this.setTurn('starting');
    void this.enqueue({
      kind: 'speculated',
      actionId,
      action,
      userId: options.userId,
    });
  }

  /** Take back a speculation the log will not confirm. Unknown ids are a no-op. */
  retract(actionId: string): void {
    void this.enqueue({ kind: 'retracted', actionId });
  }

  /**
   * Where the turn stands as this class knows it right now: the fold's last
   * report, or `starting` from the moment {@link issue} or {@link expect}
   * folded a prompt - ahead of the fold's own answer by the worker round
   * trip. What a caller reads to decide whether an action posted now would
   * reach a turn the server has opened; the listener-fed metadata lags by
   * that round trip, and two actions inside it would both read the old state.
   */
  currentTurn(): TurnState {
    return this.turn;
  }

  /**
   * Whether this action reaches the runtime now, rather than waiting in the
   * server's queue.
   *
   * ACP runs one prompt at a time, so the harness queues a prompt or a
   * compact issued while a turn is open and logs nothing until it dispatches.
   * Speculating one anyway would show it twice - a sent-looking bubble in the
   * transcript *and* the queue row that says it is waiting - and then take
   * the bubble away again. Everything else (a stop, a model change, an
   * answer) rides alongside the running turn and is folded at once.
   *
   * A disconnected runtime is not an open turn: the prompt wakes the sandbox,
   * which is exactly the wait worth showing.
   */
  private reaches(action: AgentAction): boolean {
    if (!occupiesTurn(action)) return true;
    return (
      this.turn !== 'starting' &&
      this.turn !== 'running' &&
      this.turn !== 'stopping' &&
      this.turn !== 'blocked'
    );
  }

  /** Fold events, in order. The only way anything about the fold is observed. */
  subscribe(listener: AgentSessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Everything the machine holds right now, for a listener that joined late.
   * Ordered after every input pushed so far, so a caller that subscribes
   * first and reads second misses nothing and double-applies nothing worse
   * than a message it already holds.
   */
  snapshot(): Promise<SessionFoldSnapshot> {
    return this.chain.then(() => readSession(this.id));
  }

  release(): void {
    this.references -= 1;
    if (this.references > 0) return;
    if (AgentSession.open.get(this.id) === this)
      AgentSession.open.delete(this.id);
    this.closed = true;
    // Ended here rather than where the load notices: a fetch that never
    // answers never reaches that check, and an unended span never reports.
    this.trace.end('released');
    this.listeners.clear();
    this.unsubscribeSocket();
    this.unsubscribeUpdated();
    clearTimeout(this.resyncTimer);
    this.flushCacheWrite();
    closeSession(this.id);
  }

  private async startWarm(): Promise<AgentSessionRecord | undefined> {
    const readStartedAt = performance.now();
    let cached: Awaited<ReturnType<typeof agentSessionLogCache.read>>;
    try {
      cached = await agentSessionLogCache.read(this.id);
    } catch (error) {
      console.warn('[agent-session] cached log could not be read', error);
      cached = undefined;
    }
    this.trace.cacheRead(readStartedAt, cached && { rows: cached.rows.length });
    // `settled` is set in the same tick as the fetched snapshot's push, so
    // checking it here and pushing below cannot interleave with that push:
    // a cached log never replaces a fetched one.
    if (!cached || this.closed || this.settled) return undefined;
    const foldStartedAt = performance.now();
    // `ready` stays false: live rows keep waiting for the fetched snapshot.
    await this.apply([{ kind: 'snapshot', rows: cached.rows }]);
    if (this.closed) return undefined;
    this.trace.stage('cache_fold', foldStartedAt);
    this.setTurn((await readSession(this.id)).metadata.turn);
    return { session: cached.session, bot: cached.bot };
  }

  /** A surface put this session's transcript on screen. */
  rendered(kind: 'cached' | 'fetched'): void {
    this.trace.rendered(kind);
  }

  private startLoad(): Promise<AgentSessionRecord> {
    return this.fetchAndFold().then(
      (record) => {
        this.trace.end('loaded');
        return record;
      },
      (error: unknown) => {
        this.loadFailed = true;
        this.trace.end(
          error instanceof AgentSessionReleased ? 'released' : 'failed',
          error
        );
        throw error;
      }
    );
  }

  private async fetchAndFold(): Promise<AgentSessionRecord> {
    const fetchStartedAt = performance.now();
    const [session, log] = await Promise.all([
      agentHarnessServiceClient.get(this.id).then((session) => {
        this.trace.stage('session_fetch', fetchStartedAt);
        return session;
      }),
      fetchAgentSessionLog(this.id),
    ]);
    if (session.isErr()) {
      if (accessDenied(session.error)) {
        this.forgetCached();
        throw new AgentSessionAccessDenied(this.id);
      }
      throw new Error(`agent session could not be fetched: ${this.id}`);
    }
    if (log.isErr()) {
      if (accessDenied(log.error)) {
        this.forgetCached();
        throw new AgentSessionAccessDenied(this.id);
      }
      throw new Error(`agent session log could not be fetched: ${this.id}`);
    }
    if (this.closed) throw new AgentSessionReleased(this.id);
    this.trace.fetched(fetchStartedAt, log.value.entries.length);

    const foldStartedAt = performance.now();
    this.settled = true;
    this.cached = {
      session: session.value,
      bot: log.value.bot,
      rows: [],
      rowIds: new Set(),
    };
    await this.apply([{ kind: 'snapshot', rows: log.value.entries }]);
    // Inputs can keep arriving while each push is in flight; drain until a
    // check finds nothing, then flip ready so the next one goes straight in.
    await this.drainBuffered();
    this.trace.folded(foldStartedAt);
    this.setTurn((await readSession(this.id)).metadata.turn);
    if (this.resyncRequested) void this.resync();
    return { session: session.value, bot: log.value.bot };
  }

  /** The viewer was refused: nothing cached may render for them again. */
  private forgetCached(): void {
    this.warming = Promise.resolve(undefined);
    void agentSessionLogCache.remove(this.id).catch((error: unknown) => {
      console.warn('[agent-session] cached log could not be removed', error);
    });
  }

  /**
   * Keep the cache's copy of the log in step with what the machine was
   * given, once the fetched log is what it holds: a snapshot resets it, a
   * confirmed row extends it. The machine dedupes by row id on its side;
   * this does the same so a row delivered twice is stored once.
   */
  private remember(inputs: FoldInput[]): void {
    if (!this.cached) return;
    let changed = false;
    for (const input of inputs) {
      if (input.kind === 'snapshot') {
        this.cached.rows = [...input.rows];
        this.cached.rowIds = new Set(input.rows.map((row) => row.id));
        changed = true;
      } else if (input.kind === 'confirmed') {
        if (this.cached.rowIds.has(input.row.id)) continue;
        this.cached.rows.push(input.row);
        this.cached.rowIds.add(input.row.id);
        changed = true;
      }
    }
    if (changed) this.scheduleCacheWrite();
  }

  private scheduleCacheWrite(): void {
    if (this.cacheWriteTimer !== undefined) return;
    this.cacheWriteTimer = setTimeout(() => {
      this.cacheWriteTimer = undefined;
      this.writeCache();
    }, CACHE_WRITE_DEBOUNCE_MS);
  }

  /** Write now what a pending timer would have: the session is going away. */
  private flushCacheWrite(): void {
    if (this.cacheWriteTimer === undefined) return;
    clearTimeout(this.cacheWriteTimer);
    this.cacheWriteTimer = undefined;
    this.writeCache();
  }

  private writeCache(): void {
    if (!this.cached) return;
    const { session, bot, rows } = this.cached;
    const startedAt = performance.now();
    void agentSessionLogCache.write(this.id, { session, bot, rows }).then(
      () => traceCacheWrite(this.id, startedAt, rows.length),
      (error: unknown) => {
        console.warn('[agent-session] log could not be cached', error);
      }
    );
  }

  /**
   * A reopened socket is a new socket session: rows may have been missed
   * while it was down. Refetch, and let the machine reconcile the overlap
   * and settle any speculation the log confirmed meanwhile.
   */
  private async resync(retrying = false): Promise<void> {
    if (this.closed) return;
    if (!retrying) {
      clearTimeout(this.resyncTimer);
      this.resyncRetry = 0;
    }
    this.resyncRequested = true;
    if (!this.ready || this.syncing) return;
    this.syncing = true;
    this.ready = false;
    let failed = false;
    try {
      do {
        this.resyncRequested = false;
        const log = await fetchAgentSessionLog(this.id);
        if (this.closed) return;
        failed = log.isErr() && !accessDenied(log.error);
        if (log.isOk()) {
          await this.apply([{ kind: 'snapshot', rows: log.value.entries }]);
          this.resyncRetry = 0;
        }
      } while (this.resyncRequested);
    } catch (error: unknown) {
      failed = true;
      console.warn('[agent-session] log could not be refreshed', error);
    } finally {
      // A snapshot may predate frames received during its fetch. Replay those
      // frames after it, retaining speculation and the fold's overlap deduping.
      await this.drainBuffered();
      this.syncing = false;
      if (!this.closed && this.resyncRequested) {
        void this.resync(true);
      } else if (!this.closed && failed) {
        const delay = RESYNC_RETRY_DELAYS_MS[this.resyncRetry++];
        if (delay !== undefined)
          this.resyncTimer = setTimeout(() => void this.resync(true), delay);
      }
    }
  }

  private async drainBuffered(): Promise<void> {
    while (!this.closed && this.buffered.length > 0) {
      const inputs = this.buffered;
      this.buffered = [];
      await this.apply(inputs);
    }
    // No await between observing an empty buffer and accepting live inputs.
    if (!this.closed) this.ready = true;
  }

  private enqueue(input: FoldInput): Promise<void> {
    return this.enqueueAll([input]);
  }

  private enqueueAll(inputs: FoldInput[]): Promise<void> {
    if (inputs.length === 0) return Promise.resolve();
    if (!this.ready) {
      this.buffered.push(...inputs);
      return Promise.resolve();
    }
    return this.apply(inputs);
  }

  private apply(inputs: FoldInput[]): Promise<void> {
    this.remember(inputs);
    const run = this.chain.then(async () => {
      if (this.closed) return;
      const events = await pushSession(this.id, inputs);
      if (this.closed || events.length === 0) return;
      const metadata = events.findLast((event) => event.kind === 'metadata');
      if (metadata) this.setTurn(metadata.metadata.turn);
      for (const listener of this.listeners) listener(events);
    });
    // A failed push must not poison the chain for every input after it.
    this.chain = run.catch((error: unknown) => {
      console.error('[agent-session] fold input could not be applied', error);
    });
    return this.chain;
  }
}

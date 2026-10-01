/**
 * Telemetry for following a session after it loaded: what reached the fold,
 * where it came from, and what the surface knew at the moment the person
 * looking at it gave up.
 *
 * `load-telemetry` covers opening a session. This covers the hours after: a
 * transcript that stops mid-sentence while the agent keeps working, and is
 * whole again after a reload, is a live-follow failure. Nothing about it is
 * visible from the backend - the rows were written and pushed - so the
 * client has to say what it did with them: how many rows the socket
 * delivered, how many the fold accepted, whether the socket flapped, whether
 * a resync found rows no frame ever carried, and how long the surface had
 * been silent when the tab was reloaded.
 *
 * A span is only exported when it ends, and a session can stay open all day,
 * so the follow is cut into segments: the span for the current segment ends
 * on a timer, on a stall, on release, and on `pagehide` - the reload that is
 * the user's own report of the bug. Counters are per segment; `rows.known`
 * is cumulative so a segment can be placed in the session's history.
 *
 * Failures here are swallowed. Telemetry that can break a live session is
 * worse than no telemetry.
 */

import type { Span } from '@macro-inc/observability';
import { Telemetry } from '@macro-inc/observability';
import type { SocketTransition } from '@queries/agent-session/queue-sync';
import type { TurnState } from '@service-agent-fold/generated/types';
import type {
  AgentSessionLogEntryDto,
  AgentSessionResponse,
} from '@service-agent-harness/generated/schemas';

/** Why a segment span ended. */
export type LiveEndReason =
  /** The last surface let go of the session. */
  | 'released'
  /** The tab is going away: a reload, a close, a navigation off the app. */
  | 'pagehide'
  /** {@link SEGMENT_MS} elapsed; the follow continues in the next segment. */
  | 'rotated'
  /** A turn was open and nothing reached the fold for {@link STALL_THRESHOLD_MS}. */
  | 'stalled';

/** What a resync did, or why it did nothing. */
export type ResyncOutcome =
  | 'run'
  /** The socket reopened before the snapshot folded; nothing was refetched. */
  | 'skipped_not_ready'
  | 'skipped_closed'
  | 'failed';

/** Where a snapshot of the whole log came from. */
export type SnapshotSource = 'load' | 'resync';

/**
 * How long one segment runs before its span is closed and reported. Long
 * enough that a working session is not spanned into confetti, short enough
 * that a tab that dies without `pagehide` loses little.
 */
export const SEGMENT_MS = 5 * 60_000;

/**
 * How long an open turn may go without a fold event before the segment is
 * reported as stalled. Runtimes do pause - a long tool call says nothing
 * for a while - so this is well past any pause a healthy turn produces.
 */
export const STALL_THRESHOLD_MS = 60_000;

/** Whether a turn in this state should be producing rows. */
function expectsRows(turn: TurnState): boolean {
  return turn === 'starting' || turn === 'running' || turn === 'stopping';
}

const active = new Set<SessionLiveTrace>();

function endAllOnPageHide(): void {
  for (const trace of active) trace.end('pagehide');
  // `pagehide` listeners run in registration order and the exporter's own
  // flush may already have run; flush again so the spans just ended leave
  // with the page.
  void Telemetry.flush();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', endAllOnPageHide);
}

/**
 * The follow of one shared session instance, from acquisition to whatever
 * ended it, reported in segments.
 */
export class SessionLiveTrace {
  readonly #sessionId: string;
  readonly #acquiredAt = performance.now();
  #span: Span | undefined;
  #segment = 0;
  #segmentStartedAt = performance.now();
  #ended = false;

  #rotateTimer: ReturnType<typeof setTimeout> | undefined;
  #stallTimer: ReturnType<typeof setTimeout> | undefined;

  // Identity, set once the load resolves and repeated on every segment.
  #identity: Record<string, string> = {};

  // Cumulative.
  readonly #knownRows = new Set<string>();
  #lastRowAt: number | undefined;
  #lastEventAt: number | undefined;
  #turn: TurnState = 'idle';
  #status: string | undefined;
  #listeners = 0;

  // Per segment.
  #counts = SessionLiveTrace.#freshCounts();

  static #freshCounts() {
    return {
      rowsSocket: 0,
      rowsBuffered: 0,
      rowsDuplicate: 0,
      rowsSnapshot: 0,
      pushes: 0,
      pushesFailed: 0,
      foldEvents: 0,
      resyncRun: 0,
      resyncSkippedNotReady: 0,
      resyncSkippedClosed: 0,
      resyncFailed: 0,
      resyncMissedRows: 0,
      socketOpen: 0,
      socketClose: 0,
      socketReconnect: 0,
      socketRetry: 0,
      socketHeartbeatMissed: 0,
      surfaceMessages: -1,
      surfaceMs: -1,
      surfaceSuperseded: 0,
    };
  }

  constructor(sessionId: string) {
    this.#sessionId = sessionId;
    active.add(this);
    this.#openSegment();
  }

  /** The load resolved: the row this session is, for every segment after. */
  loaded(session: AgentSessionResponse): void {
    try {
      const identity: Record<string, string> = {
        'agent.session.harness': session.harness,
        'agent.session.bot_id': session.botId,
        'agent.session.status':
          session.status.kind === 'event'
            ? session.status.event
            : session.status.kind,
      };
      if (session.external) {
        identity['agent.session.external.provider'] = session.external.provider;
        // Carries the provider's own id (a Cursor `bc-…`), which is the key
        // to that side's logs.
        if (session.external.url)
          identity['agent.session.external.url'] = session.external.url;
      }
      this.#identity = identity;
    } catch {
      // A row missing a field is the load's problem to report, not ours.
      return;
    }
    this.#applyIdentity();
  }

  /**
   * Rows the socket delivered for this session. `applied` is false when the
   * snapshot has not folded yet and the rows were buffered behind it.
   */
  ingested(rows: AgentSessionLogEntryDto[], applied: boolean): void {
    const now = performance.now();
    for (const row of rows) {
      if (this.#knownRows.has(row.id)) this.#counts.rowsDuplicate += 1;
      else this.#knownRows.add(row.id);
    }
    if (applied) this.#counts.rowsSocket += rows.length;
    else this.#counts.rowsBuffered += rows.length;
    if (rows.length > 0) this.#lastRowAt = now;
  }

  /**
   * A whole log was fetched and is about to be folded. Returns how many of
   * its rows this trace had never seen: after a load that is every row and
   * means nothing; after a resync it is the rows the socket never delivered,
   * which is the number that says the follow had a hole.
   */
  snapshot(rows: AgentSessionLogEntryDto[], source: SnapshotSource): number {
    let unseen = 0;
    for (const row of rows) {
      if (this.#knownRows.has(row.id)) continue;
      this.#knownRows.add(row.id);
      unseen += 1;
    }
    this.#counts.rowsSnapshot += rows.length;
    if (rows.length > 0) this.#lastRowAt = performance.now();
    if (source === 'resync') {
      this.#counts.resyncMissedRows += unseen;
      this.#event('agent.session.resync.snapshot', {
        'agent.session.resync.rows': rows.length,
        'agent.session.resync.missed_rows': unseen,
      });
    }
    return unseen;
  }

  /** The machine accepted a push and reported `events` fold events. */
  pushed(events: number): void {
    this.#counts.pushes += 1;
    this.#counts.foldEvents += events;
    if (events > 0) {
      this.#lastEventAt = performance.now();
      this.#armStall();
    }
  }

  /** The machine rejected a push. The inputs in it are gone from the fold. */
  pushFailed(inputs: number, error: unknown): void {
    this.#counts.pushesFailed += 1;
    this.#event('agent.session.push_failed', {
      'agent.session.push.inputs': inputs,
    });
    try {
      Telemetry.error(error, {
        'agent.session.id': this.#sessionId,
        'agent.session.push.inputs': inputs,
        'error.source': 'agent_session_fold_push',
      });
    } catch {
      // See the module comment.
    }
  }

  /** The fold's turn moved, or a speculation moved it ahead of the fold. */
  turn(turn: TurnState): void {
    if (turn !== this.#turn) {
      this.#event('agent.session.turn', {
        'agent.session.turn.from': this.#turn,
        'agent.session.turn.to': turn,
      });
    }
    this.#turn = turn;
    if (expectsRows(turn)) this.#armStall();
    else this.#disarmStall();
  }

  /** The fold's status - the last system event's wire name. */
  status(status: string | null | undefined): void {
    if (status && status !== this.#status) {
      this.#event('agent.session.status', {
        'agent.session.status.from': this.#status ?? '',
        'agent.session.status.to': status,
      });
    }
    this.#status = status ?? undefined;
  }

  /** How many surfaces are listening for fold events right now. */
  listeners(count: number): void {
    this.#listeners = count;
  }

  /** The gateway socket changed state while this session was open. */
  socket(transition: SocketTransition): void {
    switch (transition) {
      case 'open':
        this.#counts.socketOpen += 1;
        break;
      case 'close':
        this.#counts.socketClose += 1;
        break;
      case 'reconnect':
        this.#counts.socketReconnect += 1;
        break;
      case 'retry':
        this.#counts.socketRetry += 1;
        break;
      case 'heartbeat_missed':
        this.#counts.socketHeartbeatMissed += 1;
        break;
    }
    this.#event('agent.session.socket', {
      'agent.session.socket.transition': transition,
    });
  }

  /** What a socket reopening led to. */
  resync(outcome: ResyncOutcome): void {
    switch (outcome) {
      case 'run':
        this.#counts.resyncRun += 1;
        break;
      case 'skipped_not_ready':
        this.#counts.resyncSkippedNotReady += 1;
        break;
      case 'skipped_closed':
        this.#counts.resyncSkippedClosed += 1;
        break;
      case 'failed':
        this.#counts.resyncFailed += 1;
        break;
    }
    this.#event('agent.session.resync', {
      'agent.session.resync.outcome': outcome,
    });
  }

  /**
   * A surface put the loaded snapshot on screen with `messages` messages -
   * or, `superseded`, found the block had moved to another session first
   * and showed nothing.
   */
  surfaced(messages: number, superseded = false): void {
    if (superseded) {
      this.#counts.surfaceSuperseded += 1;
      return;
    }
    this.#counts.surfaceMessages = messages;
    this.#counts.surfaceMs = performance.now() - this.#acquiredAt;
  }

  /**
   * Close the current segment. `released` and `pagehide` end the follow;
   * `rotated` and `stalled` open the next segment at once. Ending twice is
   * a no-op.
   */
  end(reason: LiveEndReason): void {
    if (this.#ended) return;
    const terminal = reason === 'released' || reason === 'pagehide';
    if (terminal) {
      this.#ended = true;
      active.delete(this);
      this.#clearTimers();
    }
    this.#closeSegment(reason);
    if (!terminal) this.#openSegment();
  }

  #openSegment(): void {
    this.#segment += 1;
    this.#segmentStartedAt = performance.now();
    this.#counts = SessionLiveTrace.#freshCounts();
    try {
      const span = Telemetry.span('agent.session.live');
      span.setAttr('agent.session.id', this.#sessionId);
      span.setAttr('agent.session.live.segment', this.#segment);
      this.#span = span;
    } catch {
      this.#span = undefined;
    }
    this.#applyIdentity();
    clearTimeout(this.#rotateTimer);
    this.#rotateTimer = setTimeout(() => this.end('rotated'), SEGMENT_MS);
  }

  #closeSegment(reason: LiveEndReason): void {
    const now = performance.now();
    const counts = this.#counts;
    const age = (at: number | undefined) => (at === undefined ? -1 : now - at);
    this.#set('agent.session.live.reason', reason);
    this.#set('agent.session.live.segment_ms', now - this.#segmentStartedAt);
    this.#set('agent.session.live.age_ms', now - this.#acquiredAt);
    this.#set('agent.session.live.turn', this.#turn);
    this.#set('agent.session.live.status', this.#status ?? '');
    this.#set('agent.session.live.listeners', this.#listeners);
    this.#set('agent.session.live.last_row_age_ms', age(this.#lastRowAt));
    this.#set('agent.session.live.last_event_age_ms', age(this.#lastEventAt));
    this.#set('agent.session.live.rows.known', this.#knownRows.size);
    this.#set('agent.session.live.rows.socket', counts.rowsSocket);
    this.#set('agent.session.live.rows.buffered', counts.rowsBuffered);
    this.#set('agent.session.live.rows.duplicate', counts.rowsDuplicate);
    this.#set('agent.session.live.rows.snapshot', counts.rowsSnapshot);
    this.#set('agent.session.live.pushes', counts.pushes);
    this.#set('agent.session.live.pushes_failed', counts.pushesFailed);
    this.#set('agent.session.live.fold_events', counts.foldEvents);
    this.#set('agent.session.live.resync.run', counts.resyncRun);
    this.#set(
      'agent.session.live.resync.skipped_not_ready',
      counts.resyncSkippedNotReady
    );
    this.#set(
      'agent.session.live.resync.skipped_closed',
      counts.resyncSkippedClosed
    );
    this.#set('agent.session.live.resync.failed', counts.resyncFailed);
    this.#set('agent.session.live.resync.missed_rows', counts.resyncMissedRows);
    this.#set('agent.session.live.socket.open', counts.socketOpen);
    this.#set('agent.session.live.socket.close', counts.socketClose);
    this.#set('agent.session.live.socket.reconnect', counts.socketReconnect);
    this.#set('agent.session.live.socket.retry', counts.socketRetry);
    this.#set(
      'agent.session.live.socket.heartbeat_missed',
      counts.socketHeartbeatMissed
    );
    this.#set('agent.session.live.surface.messages', counts.surfaceMessages);
    this.#set('agent.session.live.surface_ms', counts.surfaceMs);
    this.#set(
      'agent.session.live.surface.superseded',
      counts.surfaceSuperseded
    );
    try {
      this.#span?.end();
    } catch {
      // See the module comment.
    }
    this.#span = undefined;
  }

  #stall(): void {
    this.#stallTimer = undefined;
    const silentFor =
      this.#lastEventAt === undefined
        ? performance.now() - this.#segmentStartedAt
        : performance.now() - this.#lastEventAt;
    try {
      Telemetry.warn('agent session stalled', {
        'agent.session.id': this.#sessionId,
        'agent.session.live.turn': this.#turn,
        'agent.session.live.status': this.#status ?? '',
        'agent.session.live.silent_ms': silentFor,
        'agent.session.live.rows.known': this.#knownRows.size,
        'agent.session.live.socket.close': this.#counts.socketClose,
        'agent.session.live.pushes_failed': this.#counts.pushesFailed,
        ...this.#identity,
      });
    } catch {
      // See the module comment.
    }
    // Ended now rather than at rotation so the report is not minutes late.
    this.end('stalled');
    // Not re-armed: one report per silence. The next fold event re-arms.
  }

  #armStall(): void {
    if (this.#ended || !expectsRows(this.#turn)) return;
    clearTimeout(this.#stallTimer);
    this.#stallTimer = setTimeout(() => this.#stall(), STALL_THRESHOLD_MS);
  }

  #disarmStall(): void {
    clearTimeout(this.#stallTimer);
    this.#stallTimer = undefined;
  }

  #clearTimers(): void {
    clearTimeout(this.#rotateTimer);
    this.#rotateTimer = undefined;
    this.#disarmStall();
  }

  #applyIdentity(): void {
    for (const [name, value] of Object.entries(this.#identity)) {
      this.#set(name, value);
    }
  }

  #set(name: string, value: string | number): void {
    try {
      this.#span?.setAttr(name, value);
    } catch {
      // See the module comment.
    }
  }

  #event(name: string, attributes: Record<string, string | number>): void {
    try {
      this.#span?.event(name, attributes);
    } catch {
      // See the module comment.
    }
  }
}

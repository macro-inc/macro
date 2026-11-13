import { t } from '@app/lib/i18n';
import type {
  AgentWake,
  WakeTrace,
  WakeTraceSpan,
} from '@service-agent-harness/agent-wakes';

/**
 * How long a wake may go unheard from (no record and no trace upload) before
 * a missing `end` record means it stopped reporting, e.g. its process was
 * killed, rather than that it still runs.
 */
export const LOST_AFTER_MS = 30 * 60_000;

/**
 * Where a wake stands: running until its `end` record, then how it ended;
 * `lost` once it has gone unheard from for `LOST_AFTER_MS` with no end.
 */
export type WakeState =
  | 'running'
  | 'lost'
  | 'ok'
  | 'failed'
  | 'timeout'
  | 'cancelled';

/** When Macro last heard from a wake: its latest record or trace upload. */
export function lastHeard(wake: AgentWake): number {
  const received = Date.parse(wake.receivedAt);
  const traced = wake.traceUpdatedAt ? Date.parse(wake.traceUpdatedAt) : 0;
  return Math.max(received, traced);
}

export function wakeState(wake: AgentWake, now: number): WakeState {
  const { record } = wake;
  if (record.phase === 'end' && record.status) return record.status;
  return now - lastHeard(wake) > LOST_AFTER_MS ? 'lost' : 'running';
}

/**
 * A wake's trace with what its row says: when Macro last heard from the wake
 * (`lastHeard`) and whether it has ended. When the row couldn't be read, the
 * trace's own last timestamp, and not ended.
 */
export type HeardTrace = { trace: WakeTrace; heardAt: number; ended: boolean };

export function heardTrace(
  trace: WakeTrace,
  wake: AgentWake | null
): HeardTrace {
  if (!wake) return { trace, heardAt: Date.parse(trace.endedAt), ended: false };
  return {
    trace,
    heardAt: lastHeard(wake),
    ended: wake.record.phase === 'end',
  };
}

/**
 * Whether a trace is still being added to: uploaded live, by a wake that has
 * not ended and was heard from within `LOST_AFTER_MS`, the rule a wake's row
 * uses for `running`. A live heartbeat keeps a long silent step live; a wake
 * that died mid-upload, or ended before its final trace arrived, stops
 * looking live.
 */
export function traceIsLive(heard: HeardTrace, now: number): boolean {
  return (
    heard.trace.live && !heard.ended && now - heard.heardAt <= LOST_AFTER_MS
  );
}

/** While a wake runs, its row is re-read this often to show it ending. */
export const LIVE_REFRESH_MS = 15_000;

/**
 * A wake that stopped reporting is re-read this rarely, in case it was only
 * quiet and its `end` record still comes.
 */
export const LOST_REFRESH_MS = 5 * 60_000;

/** How often a list of wakes is re-read: often while one runs, rarely while one is lost, else never. */
export function wakesRefreshMs(
  wakes: readonly AgentWake[],
  now: number
): number | false {
  const states = wakes.map((wake) => wakeState(wake, now));
  if (states.includes('running')) return LIVE_REFRESH_MS;
  if (states.includes('lost')) return LOST_REFRESH_MS;
  return false;
}

/** How often a trace is re-read: often while live, rarely once a live one goes quiet, else never. */
export function traceRefreshMs(heard: HeardTrace, now: number): number | false {
  if (traceIsLive(heard, now)) return LIVE_REFRESH_MS;
  return heard.trace.live ? LOST_REFRESH_MS : false;
}

/** `1.2s`, `14s`, `3m 05s`, `1h 02m`. */
export function formatDuration(ms: number): string {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** `$0.25`, `<$0.01`. */
export function formatCost(usd: number): string {
  return usd > 0 && usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`;
}

/**
 * How long a wake has run: its recorded duration, since it started, or, for
 * one that stopped reporting, until it was last heard from.
 */
export function wakeDuration(wake: AgentWake, now: number): number {
  const { record } = wake;
  if (record.phase === 'end' && typeof record.durationMs === 'number')
    return record.durationMs;
  const until = wakeState(wake, now) === 'lost' ? lastHeard(wake) : now;
  return Math.max(0, until - Date.parse(record.startedAt));
}

/** `event · ciFailures · nightly`. */
export function triggerLabel(wake: AgentWake): string {
  const { trigger } = wake.record;
  return [trigger.kind, trigger.source, trigger.name]
    .filter((part) => part !== undefined && part !== null && part !== '')
    .join(' · ');
}

/** One bar of a trace waterfall, in milliseconds from the trace's start. */
export type WaterfallRow = {
  span: WakeTraceSpan;
  label: string;
  offset: number;
  duration: number;
  running: boolean;
  error: boolean;
};

/**
 * Lays a trace's spans out on one time axis. A user span is an instant; a
 * running tool reaches to the trace's end.
 */
export function waterfall(
  heard: HeardTrace,
  now: number
): {
  rows: WaterfallRow[];
  total: number;
} {
  const { trace } = heard;
  const live = traceIsLive(heard, now);
  const start = Date.parse(trace.startedAt);
  const end = Date.parse(trace.endedAt);
  const total = Math.max(1, end - start);
  const at = (iso: string) => Math.max(0, Date.parse(iso) - start);
  const rows = trace.spans.map((span): WaterfallRow => {
    if (span.kind === 'user')
      return {
        span,
        label: t('dynamicUi.tracePrompt'),
        offset: at(span.at),
        duration: 0,
        running: false,
        error: false,
      };
    if (span.kind === 'turn')
      return {
        span,
        label: t('dynamicUi.traceTurn', { number: span.index + 1 }),
        offset: at(span.at),
        duration: Math.max(0, at(span.end) - at(span.at)),
        running: false,
        error: false,
      };
    const finished = span.end ?? null;
    return {
      span,
      label: span.name,
      offset: at(span.at),
      duration: Math.max(
        0,
        (finished === null ? total : at(finished)) - at(span.at)
      ),
      // A call with no result in a finished trace never returned.
      running: finished === null && live,
      error: span.error,
    };
  });
  return { rows, total };
}

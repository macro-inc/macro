import type {
  AgentWake,
  WakeTrace,
  WakeTraceSpan,
} from '@service-agent-harness/agent-wakes';

/** Where a wake stands: running until its `end` record, then how it ended. */
export type WakeState = 'running' | 'ok' | 'failed' | 'timeout' | 'cancelled';

export function wakeState(wake: AgentWake): WakeState {
  const { record } = wake;
  return record.phase === 'end' && record.status ? record.status : 'running';
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

/** How long a wake has run: its recorded duration, or since it started. */
export function wakeDuration(wake: AgentWake, now: number): number {
  const { record } = wake;
  if (record.phase === 'end' && typeof record.durationMs === 'number')
    return record.durationMs;
  return Math.max(0, now - Date.parse(record.startedAt));
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
export function waterfall(trace: WakeTrace): {
  rows: WaterfallRow[];
  total: number;
} {
  const start = Date.parse(trace.startedAt);
  const end = Date.parse(trace.endedAt);
  const total = Math.max(1, end - start);
  const at = (iso: string) => Math.max(0, Date.parse(iso) - start);
  const rows = trace.spans.map((span): WaterfallRow => {
    if (span.kind === 'user')
      return {
        span,
        label: 'Prompt',
        offset: at(span.at),
        duration: 0,
        running: false,
        error: false,
      };
    if (span.kind === 'turn')
      return {
        span,
        label: `Turn ${span.index + 1}`,
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
      running: finished === null && trace.live,
      error: span.error,
    };
  });
  return { rows, total };
}

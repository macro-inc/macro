import type { AgentWake, WakeTrace } from '@service-agent-harness/agent-wakes';
import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  LIVE_REFRESH_MS,
  LOST_AFTER_MS,
  LOST_REFRESH_MS,
  heardTrace,
  traceIsLive,
  traceRefreshMs,
  wakeDuration,
  wakeState,
  wakesRefreshMs,
  waterfall,
} from './format';

const wake = (record: Partial<AgentWake['record']>): AgentWake => ({
  receivedAt: '2026-11-11T09:00:00.000Z',
  traceUpdatedAt: null,
  record: {
    v: 1,
    phase: 'start',
    system: 'pr-factory',
    wake: 'w1',
    trace: { traceId: 't', spanId: 's' },
    trigger: { kind: 'event', source: 'ciFailures', ids: {} },
    startedAt: '2026-11-11T09:00:00.000Z',
    ...record,
  },
});

describe('a wake', () => {
  const received = Date.parse('2026-11-11T09:00:00.000Z');

  it('runs until its end record, then is how it ended', () => {
    expect(wakeState(wake({ phase: 'session' }), received)).toBe('running');
    expect(wakeState(wake({ phase: 'end', status: 'timeout' }), received)).toBe(
      'timeout'
    );
  });

  it('is lost once unheard from too long with no end record', () => {
    const late = received + LOST_AFTER_MS + 1;
    expect(
      wakeState(wake({ phase: 'session' }), received + LOST_AFTER_MS)
    ).toBe('running');
    expect(wakeState(wake({ phase: 'session' }), late)).toBe('lost');
    // A recent trace upload is hearing from it too.
    expect(
      wakeState(
        {
          ...wake({ phase: 'session' }),
          traceUpdatedAt: new Date(late - 60_000).toISOString(),
        },
        late
      )
    ).toBe('running');
    // An ended wake is never lost.
    expect(wakeState(wake({ phase: 'end', status: 'ok' }), late)).toBe('ok');
    // Its duration stops where it was last heard from.
    expect(wakeDuration(wake({ phase: 'session' }), late)).toBe(0);
    // A list refreshes often while one runs, rarely while one is lost.
    const running = wake({ phase: 'session' });
    const ended = wake({ phase: 'end', status: 'ok' });
    expect(wakesRefreshMs([ended, running], received)).toBe(LIVE_REFRESH_MS);
    expect(wakesRefreshMs([ended, running], late)).toBe(LOST_REFRESH_MS);
    expect(wakesRefreshMs([ended], late)).toBe(false);
  });

  it('grows while running and keeps its recorded duration once ended', () => {
    const now = Date.parse('2026-11-11T09:00:42.000Z');
    expect(wakeDuration(wake({}), now)).toBe(42_000);
    expect(wakeDuration(wake({ phase: 'end', durationMs: 1500 }), now)).toBe(
      1500
    );
  });

  it('reads its duration at the scale it ran', () => {
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(185_000)).toBe('3m 05s');
    expect(formatDuration(3_720_000)).toBe('1h 02m');
  });
});

describe('a trace waterfall', () => {
  it('places spans on the session axis and runs an open tool to its end', () => {
    const trace: WakeTrace = {
      v: 1,
      source: 'claude',
      sessionId: 's1',
      startedAt: '2026-11-11T09:00:00.000Z',
      endedAt: '2026-11-11T09:00:10.000Z',
      live: true,
      spans: [
        { kind: 'user', at: '2026-11-11T09:00:00.000Z', text: 'go' },
        {
          kind: 'turn',
          index: 0,
          at: '2026-11-11T09:00:01.000Z',
          end: '2026-11-11T09:00:03.000Z',
          text: '',
          thinking: '',
          tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
        },
        {
          kind: 'tool',
          id: 't1',
          turn: 0,
          at: '2026-11-11T09:00:04.000Z',
          name: 'Bash',
          input: {},
          error: false,
        },
      ],
    };
    const now = Date.parse(trace.endedAt);
    const heard = heardTrace(trace, null);
    const { rows, total } = waterfall(heard, now);
    expect(total).toBe(10_000);
    expect(rows.map((row) => [row.label, row.offset, row.duration])).toEqual([
      ['Prompt', 0, 0],
      ['Turn 1', 1000, 2000],
      ['Bash', 4000, 6000],
    ]);
    expect(rows[2]?.running).toBe(true);
    const ended = { ...heard, trace: { ...trace, live: false } };
    expect(waterfall(ended, now).rows[2]?.running).toBe(false);
    // A live trace whose wake went unheard from long ago is no longer live.
    const stale = now + LOST_AFTER_MS + 1;
    expect(traceIsLive(heard, now)).toBe(true);
    expect(traceIsLive(heard, stale)).toBe(false);
    expect(waterfall(heard, stale).rows[2]?.running).toBe(false);
    expect(traceRefreshMs(heard, now)).toBe(LIVE_REFRESH_MS);
    expect(traceRefreshMs(heard, stale)).toBe(LOST_REFRESH_MS);
    expect(traceRefreshMs(ended, now)).toBe(false);
  });
});

describe('a live trace in a long silent step', () => {
  it('stays live while its wake is heard from, by the wake row rule', () => {
    const trace: WakeTrace = {
      v: 1,
      source: 'claude',
      sessionId: 's1',
      startedAt: '2026-11-11T09:00:00.000Z',
      endedAt: '2026-11-11T09:00:10.000Z',
      live: true,
      spans: [
        {
          kind: 'tool',
          id: 't1',
          turn: 0,
          at: '2026-11-11T09:00:04.000Z',
          name: 'Bash',
          input: {},
          error: false,
        },
      ],
    };
    // The tool has run for 50 minutes; the heartbeat uploaded a minute ago.
    const now = Date.parse('2026-11-11T09:50:00.000Z');
    const row: AgentWake = {
      ...wake({ phase: 'session' }),
      traceUpdatedAt: new Date(now - 60_000).toISOString(),
    };
    const heard = heardTrace(trace, row);
    expect(wakeState(row, now)).toBe('running');
    expect(traceIsLive(heard, now)).toBe(true);
    expect(waterfall(heard, now).rows[0]?.running).toBe(true);
    expect(traceRefreshMs(heard, now)).toBe(LIVE_REFRESH_MS);
    // Without the row, the trace's own last moment is all there is.
    expect(traceIsLive(heardTrace(trace, null), now)).toBe(false);
    // Once the wake goes lost, so does the trace.
    const lost = now + LOST_AFTER_MS + 1;
    expect(wakeState(row, lost)).toBe('lost');
    expect(traceIsLive(heard, lost)).toBe(false);
    // A wake that ended before its final trace arrived stops looking live at
    // once, but the trace is still re-read in case that trace comes.
    const ended = heardTrace(trace, {
      ...row,
      record: { ...row.record, phase: 'end', status: 'ok' },
    });
    expect(traceIsLive(ended, now)).toBe(false);
    expect(waterfall(ended, now).rows[0]?.running).toBe(false);
    expect(traceRefreshMs(ended, now)).toBe(LOST_REFRESH_MS);
  });
});

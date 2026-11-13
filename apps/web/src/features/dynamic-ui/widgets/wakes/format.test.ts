import type { AgentWake, WakeTrace } from '@service-agent-harness/agent-wakes';
import { describe, expect, it } from 'vitest';
import { formatDuration, wakeDuration, wakeState, waterfall } from './format';

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
  it('runs until its end record, then is how it ended', () => {
    expect(wakeState(wake({ phase: 'session' }))).toBe('running');
    expect(wakeState(wake({ phase: 'end', status: 'timeout' }))).toBe(
      'timeout'
    );
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
    const { rows, total } = waterfall(trace);
    expect(total).toBe(10_000);
    expect(rows.map((row) => [row.label, row.offset, row.duration])).toEqual([
      ['Prompt', 0, 0],
      ['Turn 1', 1000, 2000],
      ['Bash', 4000, 6000],
    ]);
    expect(rows[2]?.running).toBe(true);
    expect(waterfall({ ...trace, live: false }).rows[2]?.running).toBe(false);
  });
});

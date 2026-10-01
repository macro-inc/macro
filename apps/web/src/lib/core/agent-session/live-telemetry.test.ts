/**
 * @vitest-environment jsdom
 *
 * The segmenting of a follow: a span per segment, closed by the rotation
 * timer, by a stall, by release, and by the page going away - each with the
 * reason and the state at that moment.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FakeSpan = {
  name: string;
  attrs: Record<string, unknown>;
  events: { name: string; attrs?: Record<string, unknown> }[];
  ended: boolean;
};

const telemetry = vi.hoisted(() => ({
  spans: [] as FakeSpan[],
  warn: vi.fn(),
  error: vi.fn(),
  flush: vi.fn(async () => {}),
}));

vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    span: (name: string) => {
      const span: FakeSpan = { name, attrs: {}, events: [], ended: false };
      telemetry.spans.push(span);
      return {
        setAttr: (key: string, value: unknown) => {
          span.attrs[key] = value;
        },
        event: (eventName: string, attrs?: Record<string, unknown>) => {
          span.events.push({ name: eventName, attrs });
        },
        error: () => {},
        end: () => {
          span.ended = true;
        },
      };
    },
    warn: telemetry.warn,
    error: telemetry.error,
    flush: telemetry.flush,
  },
}));

import type { AgentSessionLogEntryDto } from '@service-agent-harness/generated/schemas';
import {
  SEGMENT_MS,
  SessionLiveTrace,
  STALL_THRESHOLD_MS,
} from './live-telemetry';

const SESSION = '01a0ee4b-888a-7afe-b4f2-af77877b8a4c';

const row = (n: number) =>
  ({ id: `row-${n}`, createdAt: '' }) as AgentSessionLogEntryDto;

const spans = () => telemetry.spans;
const ended = () => spans().filter((span) => span.ended);
const open = () => spans().filter((span) => !span.ended);

beforeEach(() => {
  vi.useFakeTimers();
  telemetry.spans.length = 0;
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('SessionLiveTrace', () => {
  it('opens one segment span at once and ends it on release', () => {
    const trace = new SessionLiveTrace(SESSION);
    expect(open()).toHaveLength(1);
    expect(open()[0]!.attrs).toMatchObject({
      'agent.session.id': SESSION,
      'agent.session.live.segment': 1,
    });

    trace.end('released');
    expect(open()).toHaveLength(0);
    expect(ended()[0]!.attrs['agent.session.live.reason']).toBe('released');

    // Ending twice reports nothing more.
    trace.end('released');
    expect(spans()).toHaveLength(1);
  });

  it('rotates into a new segment on the timer and carries identity over', () => {
    const trace = new SessionLiveTrace(SESSION);
    trace.loaded({
      harness: 'cursor',
      botId: 'bot|cursor',
      status: { kind: 'event', event: 'acp_ready' },
      external: {
        provider: 'cursor',
        url: 'https://cursor.com/agents?id=bc-1',
      },
    } as never);
    trace.ingested([row(1), row(2)], true);

    vi.advanceTimersByTime(SEGMENT_MS);

    expect(ended()).toHaveLength(1);
    expect(ended()[0]!.attrs).toMatchObject({
      'agent.session.live.reason': 'rotated',
      'agent.session.live.segment': 1,
      'agent.session.live.rows.socket': 2,
      'agent.session.live.rows.known': 2,
      'agent.session.harness': 'cursor',
      'agent.session.external.provider': 'cursor',
      'agent.session.external.url': 'https://cursor.com/agents?id=bc-1',
    });
    expect(open()).toHaveLength(1);
    // Per-segment counters reset; identity and cumulative counts persist.
    trace.end('released');
    expect(ended()[1]!.attrs).toMatchObject({
      'agent.session.live.segment': 2,
      'agent.session.live.rows.socket': 0,
      'agent.session.live.rows.known': 2,
      'agent.session.harness': 'cursor',
    });
  });

  it('reports a stall when an open turn goes silent, once per silence', () => {
    const trace = new SessionLiveTrace(SESSION);
    trace.turn('running');
    trace.pushed(1);

    vi.advanceTimersByTime(STALL_THRESHOLD_MS - 1);
    expect(ended()).toHaveLength(0);
    vi.advanceTimersByTime(1);

    expect(telemetry.warn).toHaveBeenCalledWith(
      'agent session stalled',
      expect.objectContaining({
        'agent.session.id': SESSION,
        'agent.session.live.turn': 'running',
      })
    );
    expect(ended()).toHaveLength(1);
    expect(ended()[0]!.attrs['agent.session.live.reason']).toBe('stalled');

    // Still silent: no second report until something arrives.
    vi.advanceTimersByTime(STALL_THRESHOLD_MS * 2);
    expect(telemetry.warn).toHaveBeenCalledOnce();

    // An event re-arms the watch.
    trace.pushed(1);
    vi.advanceTimersByTime(STALL_THRESHOLD_MS);
    expect(telemetry.warn).toHaveBeenCalledTimes(2);
    trace.end('released');
  });

  it('does not call a settled turn stalled', () => {
    const trace = new SessionLiveTrace(SESSION);
    trace.turn('running');
    trace.pushed(1);
    trace.turn('idle');

    vi.advanceTimersByTime(STALL_THRESHOLD_MS * 2);
    expect(telemetry.warn).not.toHaveBeenCalled();

    // Waiting on the user is not the agent going quiet.
    trace.turn('blocked');
    vi.advanceTimersByTime(STALL_THRESHOLD_MS * 2);
    expect(telemetry.warn).not.toHaveBeenCalled();
    trace.end('released');
  });

  it('ends every open follow when the page hides, then flushes', () => {
    const first = new SessionLiveTrace(SESSION);
    const second = new SessionLiveTrace('other');
    first.turn('running');
    first.ingested([row(1)], true);

    window.dispatchEvent(new Event('pagehide'));

    expect(open()).toHaveLength(0);
    for (const span of ended()) {
      expect(span.attrs['agent.session.live.reason']).toBe('pagehide');
    }
    expect(ended()[0]!.attrs).toMatchObject({
      'agent.session.live.turn': 'running',
      'agent.session.live.rows.socket': 1,
    });
    expect(telemetry.flush).toHaveBeenCalledOnce();

    // Nothing left to time out or rotate.
    vi.advanceTimersByTime(SEGMENT_MS * 2);
    expect(spans()).toHaveLength(2);
    first.end('released');
    second.end('released');
    expect(spans()).toHaveLength(2);
  });

  it('tells resync rows apart from rows the socket already delivered', () => {
    const trace = new SessionLiveTrace(SESSION);
    expect(trace.snapshot([row(1), row(2)], 'load')).toBe(2);
    trace.ingested([row(3)], true);
    // Row 3 came over the socket after the socket dropped; row 4 did not.
    expect(trace.snapshot([row(1), row(2), row(3), row(4)], 'resync')).toBe(1);
    // A frame the resync already covered.
    trace.ingested([row(4)], true);

    trace.end('released');
    expect(ended()[0]!.attrs).toMatchObject({
      'agent.session.live.rows.known': 4,
      'agent.session.live.rows.duplicate': 1,
      'agent.session.live.resync.missed_rows': 1,
    });
  });

  it('marks state transitions as span events', () => {
    const trace = new SessionLiveTrace(SESSION);
    trace.turn('starting');
    trace.status('acp_ready');
    trace.socket('close');
    trace.resync('failed');
    trace.end('released');

    expect(ended()[0]!.events).toEqual([
      {
        name: 'agent.session.turn',
        attrs: {
          'agent.session.turn.from': 'idle',
          'agent.session.turn.to': 'starting',
        },
      },
      {
        name: 'agent.session.status',
        attrs: {
          'agent.session.status.from': '',
          'agent.session.status.to': 'acp_ready',
        },
      },
      {
        name: 'agent.session.socket',
        attrs: { 'agent.session.socket.transition': 'close' },
      },
      {
        name: 'agent.session.resync',
        attrs: { 'agent.session.resync.outcome': 'failed' },
      },
    ]);
    expect(ended()[0]!.attrs['agent.session.live.resync.failed']).toBe(1);
  });
});

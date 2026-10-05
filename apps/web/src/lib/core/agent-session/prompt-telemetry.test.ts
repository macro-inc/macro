/**
 * The `agent.prompt` span read off literal fold events: the confirmed user
 * message fixes the turn, the first agent message in it ends the span.
 */

import type { FoldedStreamEvent } from '@service-agent-fold/generated/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type RecordedSpan = {
  name: string;
  attributes: Record<string, unknown>;
  events: { name: string; attributes?: Record<string, unknown> }[];
  errors: unknown[];
  ends: number;
};

const telemetry = vi.hoisted(() => ({ spans: [] as RecordedSpan[] }));

vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    span: (name: string) => {
      const record: RecordedSpan = {
        name,
        attributes: {},
        events: [],
        errors: [],
        ends: 0,
      };
      telemetry.spans.push(record);
      return {
        setAttr: (key: string, value: unknown) => {
          record.attributes[key] = value;
        },
        event: (eventName: string, attributes?: Record<string, unknown>) => {
          record.events.push({ name: eventName, attributes });
        },
        error: (error: unknown) => {
          record.errors.push(error);
        },
        run: <T>(operation: () => T) => operation(),
        end: () => {
          record.ends += 1;
        },
      };
    },
  },
}));

import { PromptTrace } from './prompt-telemetry';

const SESSION = '01a0abed-279f-724c-9f49-60dbedc79b6e';
const ACTION = '01a0abed-3000-7000-8000-000000000001';

beforeEach(() => {
  telemetry.spans.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PromptTrace', () => {
  it('records the prompt from acceptance through confirmation to the first agent output', () => {
    const trace = new PromptTrace(SESSION, { newSession: false });
    trace.expect(ACTION);
    trace.accepted(ACTION, false);

    const speculated: FoldedStreamEvent[] = [
      {
        kind: 'new',
        message: {
          agentSessionId: SESSION,
          turn: 1,
          author: { kind: 'user', userId: 'macro|wolf@macro.com' },
          requestId: ACTION,
          parts: [{ kind: 'text', text: 'hi' }],
          stop: null,
          pending: true,
        },
      },
    ];
    trace.observe(speculated);
    const confirmed: FoldedStreamEvent[] = [
      {
        kind: 'update',
        message: {
          agentSessionId: SESSION,
          turn: 1,
          author: { kind: 'user', userId: 'macro|wolf@macro.com' },
          requestId: ACTION,
          parts: [{ kind: 'text', text: 'hi' }],
          stop: null,
          pending: false,
        },
      },
    ];
    trace.observe(confirmed);
    const output: FoldedStreamEvent[] = [
      {
        kind: 'new',
        message: {
          agentSessionId: SESSION,
          turn: 1,
          author: { kind: 'agent' },
          requestId: null,
          parts: [{ kind: 'text', text: 'hello' }],
          stop: null,
          pending: false,
        },
      },
    ];
    trace.observe(output);
    trace.observe(output);

    expect(telemetry.spans).toHaveLength(1);
    const [span] = telemetry.spans;
    expect(span.name).toBe('agent.prompt');
    expect(span.ends).toBe(1);
    expect(span.attributes).toMatchObject({
      'agent.session.id': SESSION,
      'agent.prompt.new_session': false,
      'agent.prompt.action_id': ACTION,
      'agent.prompt.turn': 1,
      'agent.prompt.first_output_part': 'text',
      'agent.prompt.outcome': 'output',
    });
    expect(span.attributes).not.toHaveProperty('agent.prompt.queued');
    for (const stage of ['accepted', 'confirmed', 'first_output']) {
      expect(span.attributes[`agent.prompt.${stage}_at_ms`]).toEqual(
        expect.any(Number)
      );
    }
    expect(span.attributes['agent.prompt.total_ms']).toEqual(
      expect.any(Number)
    );
    expect(span.events.map((event) => event.name)).toEqual([
      'agent.prompt.accepted',
      'agent.prompt.confirmed',
      'agent.prompt.first_output',
    ]);
    expect(trace.ended).toBe(true);
  });

  it('ends with no_output when the turn stops before the agent says anything', () => {
    const trace = new PromptTrace(SESSION, { newSession: true });
    trace.expect(ACTION);

    trace.observe([
      {
        kind: 'replace',
        messages: [
          {
            agentSessionId: SESSION,
            turn: 0,
            author: { kind: 'agent' },
            requestId: null,
            parts: [{ kind: 'text', text: 'an earlier turn' }],
            stop: { kind: 'end_turn' },
            pending: false,
          },
          {
            agentSessionId: SESSION,
            turn: 1,
            author: { kind: 'user', userId: 'macro|wolf@macro.com' },
            requestId: ACTION,
            parts: [{ kind: 'text', text: 'hi' }],
            stop: { kind: 'cancelled' },
            pending: false,
          },
        ],
      },
    ]);

    const [span] = telemetry.spans;
    expect(span.ends).toBe(1);
    expect(span.attributes).toMatchObject({
      'agent.prompt.new_session': true,
      'agent.prompt.turn': 1,
      'agent.prompt.stop': 'cancelled',
      'agent.prompt.outcome': 'no_output',
    });
    expect(span.attributes).not.toHaveProperty(
      'agent.prompt.first_output_at_ms'
    );
  });

  it('reports a prompt still waiting after five minutes as stalled', () => {
    vi.useFakeTimers();
    const trace = new PromptTrace(SESSION, { newSession: false });

    vi.advanceTimersByTime(5 * 60_000 - 1);
    expect(telemetry.spans[0].ends).toBe(0);
    vi.advanceTimersByTime(1);

    expect(trace.ended).toBe(true);
    expect(telemetry.spans[0].ends).toBe(1);
    expect(telemetry.spans[0].attributes['agent.prompt.outcome']).toBe(
      'stalled'
    );
  });
});

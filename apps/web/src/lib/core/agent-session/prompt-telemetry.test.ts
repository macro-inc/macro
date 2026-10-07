/**
 * The `agent.prompt` span read off literal fold events: the confirmed user
 * message fixes the turn, and the turn's first agent text, once painted,
 * ends the span.
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

import { frameDelivery, PromptTrace } from './prompt-telemetry';

const SESSION = '01a0abed-279f-724c-9f49-60dbedc79b6e';
const ACTION = '01a0abed-3000-7000-8000-000000000001';

beforeEach(() => {
  telemetry.spans.length = 0;
  vi.stubGlobal('IntersectionObserver', undefined);
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) =>
    setTimeout(callback, 16)
  );
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(10, 10, 300, 30)
  );
  const createRange = document.createRange.bind(document);
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    const range = createRange();
    range.getClientRects = () => {
      const rects = [
        range.startContainer.parentElement!.getBoundingClientRect(),
      ];
      return Object.assign(rects, { item: (index: number) => rects[index] });
    };
    return range;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  history.replaceState(null, '', '/');
});

function withText(text = 'Hello'): PromptTrace {
  const trace = new PromptTrace(SESSION, { newSession: true });
  trace.expect(ACTION);
  trace.observe([
    {
      kind: 'new',
      message: {
        agentSessionId: SESSION,
        turn: 1,
        author: { kind: 'user', userId: null },
        requestId: ACTION,
        parts: [{ kind: 'text', text: 'Question' }],
        stop: null,
        pending: false,
      },
    },
    {
      kind: 'new',
      message: {
        agentSessionId: SESSION,
        turn: 1,
        author: { kind: 'agent' },
        requestId: null,
        parts: [{ kind: 'text', text }],
        stop: null,
        pending: false,
      },
    },
  ]);
  return trace;
}

describe('PromptTrace', () => {
  it('keeps raw text and actual readable paint separate', async () => {
    vi.useFakeTimers();
    const trace = withText('**');
    const element = document.createElement('div');
    element.textContent = '**';
    document.body.append(element);
    trace.observeRenderedText(1, element);
    vi.advanceTimersByTime(32);
    const [span] = telemetry.spans;
    expect(span.attributes).toHaveProperty('agent.prompt.first_text_at_ms');
    expect(span.attributes).not.toHaveProperty(
      'agent.prompt.first_text_paint_at_ms'
    );
    expect(trace.ended).toBe(false);

    element.textContent = 'Readable answer';
    await Promise.resolve();
    vi.advanceTimersByTime(32);
    expect(span.attributes['agent.prompt.outcome']).toBe('text');
    expect(span.attributes['agent.prompt.first_text_paint_at_ms']).toBe(64);
    expect(JSON.stringify(span)).not.toContain('Readable answer');
  });

  it('reports raw text without a transcript as not rendered', () => {
    vi.useFakeTimers();
    const trace = withText();
    vi.advanceTimersByTime(32);
    expect(trace.ended).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(telemetry.spans[0].attributes).toMatchObject({
      'agent.prompt.outcome': 'not_rendered',
      'agent.prompt.renderer_mounted': false,
      'agent.prompt.renderer_attached': false,
    });
  });

  it('cannot finish from a different turn, and records an unmounted renderer explicitly', () => {
    vi.useFakeTimers();
    const trace = withText();
    const element = document.createElement('div');
    element.textContent = 'Hello';
    document.body.append(element);
    expect(trace.observeRenderedText(2, element)).toBeUndefined();
    vi.advanceTimersByTime(32);
    expect(trace.ended).toBe(false);

    const stop = trace.observeRenderedText(1, element);
    stop?.();
    element.remove();
    vi.advanceTimersByTime(10_000);
    expect(telemetry.spans[0].attributes).toMatchObject({
      'agent.prompt.outcome': 'not_rendered',
      'agent.prompt.renderer_mounted': true,
      'agent.prompt.renderer_attached': false,
    });
    expect(telemetry.spans[0].attributes).not.toHaveProperty(
      'agent.prompt.first_text_paint_at_ms'
    );
  });

  it('records how a new session was asked for', () => {
    const trace = new PromptTrace(SESSION, {
      newSession: true,
      create: {
        warmClaim: 'miss_model',
        modelOverride: true,
        modelFallback: false,
        effort: 'high',
      },
    });
    trace.end('released');
    expect(telemetry.spans[0].attributes).toMatchObject({
      'agent.prompt.warm_claim': 'miss_model',
      'agent.prompt.model_override_set': true,
      'agent.prompt.model_fallback': false,
      'agent.prompt.effort_override': true,
      'agent.prompt.effort': 'high',
    });
  });

  it('records the input delay of the event that sent the prompt', () => {
    const button = document.createElement('button');
    let trace: PromptTrace | undefined;
    button.addEventListener('click', () => {
      trace = new PromptTrace(SESSION, { newSession: false });
    });
    const click = new MouseEvent('click');
    Object.defineProperty(click, 'timeStamp', {
      value: performance.now() - 40,
    });
    button.dispatchEvent(click);
    trace?.end('released');
    expect(telemetry.spans[0].attributes['agent.prompt.input_kind']).toBe(
      'pointer'
    );
    expect(
      telemetry.spans[0].attributes['agent.prompt.input_delay_ms']
    ).toBeGreaterThanOrEqual(40);

    new PromptTrace(SESSION, { newSession: false }).end('released');
    expect(telemetry.spans[1].attributes).not.toHaveProperty(
      'agent.prompt.input_delay_ms'
    );
  });

  it('records when the create and prompt responses arrived, apart from when they were handled', () => {
    const observers: ((entries: PerformanceEntry[]) => void)[] = [];
    vi.stubGlobal(
      'PerformanceObserver',
      class {
        constructor(callback: (list: PerformanceObserverEntryList) => void) {
          observers.push((entries) =>
            callback({
              getEntries: () => entries,
            } as PerformanceObserverEntryList)
          );
        }
        observe() {}
        takeRecords() {
          return [];
        }
        disconnect() {}
      }
    );
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const fetched = (path: string, startTime: number, responseEnd: number) =>
      ({
        entryType: 'resource',
        initiatorType: 'fetch',
        name: `https://harness.test${path}`,
        startTime,
        responseEnd,
      }) as PerformanceResourceTiming;
    const trace = new PromptTrace(SESSION, { newSession: true });
    expect(observers).toHaveLength(1);
    const [deliver] = observers;
    deliver([
      fetched('/agent-sessions/warm', 990, 1020),
      fetched('/agent-sessions', 1005, 1049),
      fetched(`/agent-sessions/${SESSION}/log`, 1050, 1100),
    ]);
    // The effort path's configure control left before the prompt's.
    deliver([fetched(`/agent-sessions/${SESSION}/control`, 1060, 1090)]);
    now.mockReturnValue(1100);
    trace.expect(ACTION);
    deliver([fetched(`/agent-sessions/${SESSION}/control`, 1101, 1300)]);
    trace.end('released');
    expect(telemetry.spans[0].attributes).toMatchObject({
      'agent.prompt.created_response_end_at_ms': 49,
      'agent.prompt.accepted_response_end_at_ms': 300,
    });
  });

  it('reads a response end still buffered when the span ends', () => {
    const buffered: PerformanceEntry[] = [];
    vi.stubGlobal(
      'PerformanceObserver',
      class {
        observe() {}
        takeRecords() {
          return buffered.splice(0);
        }
        disconnect() {
          buffered.length = 0;
        }
      }
    );
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    const trace = new PromptTrace(SESSION, { newSession: true });
    buffered.push({
      entryType: 'resource',
      initiatorType: 'fetch',
      name: 'https://harness.test/agent-sessions',
      startTime: 1005,
      responseEnd: 1049,
    } as PerformanceResourceTiming);
    trace.end('failed');
    expect(
      telemetry.spans[0].attributes['agent.prompt.created_response_end_at_ms']
    ).toBe(49);
  });

  it.each([
    ['/app/md/private-document-id', 'document'],
    ['/app/drive/md/private-document-id', 'document'],
    ['/app/drive/shared/pdf/private-document-id', 'document'],
    [
      '/app/drive/folder/private-folder-id/code/private-document-id',
      'document',
    ],
    ['/app/drive/folder/private-folder-id', 'drive'],
    ['/app/drive', 'drive'],
    ['/app/home', 'home'],
    ['/app/agents', 'agents'],
    ['/app/search', 'search'],
    ['/app/drive/md/private-document-id/~/home', 'other'],
  ])('records only a bounded submit surface for %s', (path, surface) => {
    history.replaceState(null, '', path);
    const trace = new PromptTrace(SESSION, { newSession: true });
    trace.end('released');
    expect(telemetry.spans[0].attributes['agent.prompt.submit_surface']).toBe(
      surface
    );
    expect(JSON.stringify(telemetry.spans[0])).not.toContain('private-');
  });

  it.each(['home', 'agents', 'mobile_composer'] as const)(
    'uses the submitting %s composer instead of another split pane',
    (submitSurface) => {
      history.replaceState(
        null,
        '',
        '/app/drive/md/private-document-id/~/home/~/agents'
      );
      const trace = new PromptTrace(SESSION, {
        newSession: true,
        submitSurface,
      });
      trace.end('released');
      expect(telemetry.spans[0].attributes['agent.prompt.submit_surface']).toBe(
        submitSurface
      );
      expect(JSON.stringify(telemetry.spans[0])).not.toContain('private-');
    }
  );

  it('records the prompt from acceptance through confirmation to the first painted text', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) =>
      setTimeout(callback, 16)
    );
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
    expect(trace.ended).toBe(false);
    const answer = document.createElement('div');
    answer.textContent = 'hello';
    document.body.append(answer);
    trace.observeRenderedText(1, answer);
    vi.advanceTimersByTime(32);

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
      'agent.prompt.outcome': 'text',
    });
    expect(span.attributes).not.toHaveProperty('agent.prompt.queued');
    for (const stage of [
      'accepted',
      'confirmed',
      'first_output',
      'first_text',
      'text_mounted',
      'first_text_rendered',
      'first_text_paint',
    ]) {
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
      'agent.prompt.first_text',
      'agent.prompt.text_mounted',
      'agent.prompt.first_text_rendered',
      'agent.prompt.first_text_paint',
    ]);
    expect(trace.ended).toBe(true);
  });

  it('ends with no_text when the turn stops after only reasoning', () => {
    const trace = new PromptTrace(SESSION, { newSession: false });
    trace.expect(ACTION);

    trace.observe([
      {
        kind: 'new',
        message: {
          agentSessionId: SESSION,
          turn: 0,
          author: { kind: 'user', userId: null },
          requestId: ACTION,
          parts: [{ kind: 'text', text: 'hi' }],
          stop: null,
          pending: false,
        },
      },
      {
        kind: 'new',
        message: {
          agentSessionId: SESSION,
          turn: 0,
          author: { kind: 'agent' },
          requestId: null,
          parts: [{ kind: 'thought', text: 'nothing to say' }],
          stop: { kind: 'end_turn' },
          pending: false,
        },
      },
    ]);

    const [span] = telemetry.spans;
    expect(span.ends).toBe(1);
    expect(span.attributes).toMatchObject({
      'agent.prompt.first_output_part': 'thought',
      'agent.prompt.stop': 'end_turn',
      'agent.prompt.outcome': 'no_text',
    });
  });

  it('splits the first text into its delivery from the server and its fold', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-10-05T12:00:00.250Z'));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const trace = new PromptTrace(SESSION, { newSession: false });
    trace.expect(ACTION);
    const delivery = frameDelivery('socket', [
      { createdAt: '2026-10-05T12:00:00.100Z' },
      { createdAt: '2026-10-05T12:00:00.200Z' },
    ]);
    expect(delivery?.lagMs).toBe(50);
    expect(frameDelivery('snapshot', [])).toBeUndefined();

    trace.observe(
      [
        {
          kind: 'new',
          message: {
            agentSessionId: SESSION,
            turn: 0,
            author: { kind: 'user', userId: null },
            requestId: ACTION,
            parts: [{ kind: 'text', text: 'hi' }],
            stop: null,
            pending: false,
          },
        },
        {
          kind: 'new',
          message: {
            agentSessionId: SESSION,
            turn: 0,
            author: { kind: 'agent' },
            requestId: null,
            parts: [{ kind: 'text', text: 'Hello' }],
            stop: null,
            pending: false,
          },
        },
      ],
      delivery
    );

    // A hidden tab never paints, so the span ends at the first text.
    const [span] = telemetry.spans;
    expect(span.ends).toBe(1);
    expect(span.attributes).toMatchObject({
      'agent.prompt.first_text_via': 'socket',
      'agent.prompt.first_text_delivery_ms': 50,
      'agent.prompt.first_text_fold_ms': 0,
      'agent.prompt.hidden': true,
      'agent.prompt.outcome': 'hidden',
    });
    expect(span.attributes).not.toHaveProperty(
      'agent.prompt.first_text_paint_at_ms'
    );
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

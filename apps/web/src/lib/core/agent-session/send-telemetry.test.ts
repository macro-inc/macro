import type {
  FoldedMessage,
  FoldedStreamEvent,
} from '@service-agent-fold/generated/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const span = vi.hoisted(() => ({
  setAttr: vi.fn(),
  event: vi.fn(),
  error: vi.fn(),
  end: vi.fn(),
  run: vi.fn(<T>(operation: () => T) => operation()),
  span: vi.fn(),
}));

vi.mock('@macro-inc/observability', () => ({
  Telemetry: { span: vi.fn(() => span) },
}));

import { Telemetry } from '@macro-inc/observability';
import {
  observeSend,
  resetSendTraces,
  SEND_STALL_THRESHOLD_MS,
  sendTraceFor,
  startSend,
} from './send-telemetry';

const SESSION = 'session-1';

function userPrompt(turn: number): FoldedMessage {
  return {
    agentSessionId: SESSION,
    requestId: 'action-1',
    pending: false,
    turn,
    author: { kind: 'user', userId: 'u' },
    stop: null,
    parts: [{ kind: 'text', text: 'Build it' }],
  } as FoldedMessage;
}

function agentReply(turn: number): FoldedMessage {
  return {
    agentSessionId: SESSION,
    requestId: null,
    pending: false,
    turn,
    author: { kind: 'agent' },
    stop: null,
    parts: [{ kind: 'text', text: 'Working on it' }],
  } as FoldedMessage;
}

function control(turn: number): FoldedMessage {
  return {
    agentSessionId: SESSION,
    requestId: 'action-2',
    pending: false,
    turn,
    author: { kind: 'user', userId: 'u' },
    stop: null,
    parts: [
      {
        kind: 'control',
        control: { kind: 'stop' },
        outcome: { kind: 'pending' },
      },
    ],
  } as FoldedMessage;
}

function attrs(): Record<string, string | number> {
  return Object.fromEntries(span.setAttr.mock.calls);
}

beforeEach(() => {
  vi.clearAllMocks();
  span.span.mockReturnValue(span);
});

afterEach(() => {
  resetSendTraces();
  vi.useRealTimers();
});

describe('startSend', () => {
  it('opens an agent.send span without the prompt text', () => {
    startSend('pending-1', {
      surface: 'new_chat',
      promptChars: 12,
      attachmentCount: 1,
    });

    expect(Telemetry.span).toHaveBeenCalledWith('agent.send');
    expect(attrs()).toEqual({
      'agent.send.surface': 'new_chat',
      'agent.send.prompt_chars': 12,
      'agent.send.attachment_count': 1,
    });
  });

  it('stamps the session id immediately for a follow-up send', () => {
    startSend(SESSION, {
      surface: 'session',
      promptChars: 4,
      attachmentCount: 0,
    });

    expect(attrs()['agent.session.id']).toBe(SESSION);
  });

  it('ends a send already open on the same key as superseded', () => {
    const first = startSend(SESSION, {
      surface: 'session',
      promptChars: 1,
      attachmentCount: 0,
    });
    const second = startSend(SESSION, {
      surface: 'session',
      promptChars: 2,
      attachmentCount: 0,
    });

    expect(attrs()['agent.send.outcome']).toBe('superseded');
    expect(span.end).toHaveBeenCalledOnce();
    expect(sendTraceFor(SESSION)).toBe(second);
    expect(sendTraceFor(SESSION)).not.toBe(first);
  });
});

describe('AgentSendTrace', () => {
  it('adopts the real session id so later observations find it', () => {
    const trace = startSend('pending-1', {
      surface: 'new_chat',
      promptChars: 5,
      attachmentCount: 0,
    });
    trace.adopt(SESSION);

    expect(sendTraceFor('pending-1')).toBeUndefined();
    expect(sendTraceFor(SESSION)).toBe(trace);
    expect(attrs()['agent.session.id']).toBe(SESSION);
  });

  it('records create and prompt milestones without ending', () => {
    const trace = startSend('pending-1', {
      surface: 'new_chat',
      promptChars: 5,
      attachmentCount: 0,
    });
    trace.adopt(SESSION);
    trace.created();
    trace.prompted('action-9');

    expect(span.event).toHaveBeenCalledWith('session.created');
    expect(span.event).toHaveBeenCalledWith('prompt.accepted');
    expect(attrs()['agent.action.id']).toBe('action-9');
    expect(typeof attrs()['agent.send.create_ms']).toBe('number');
    expect(typeof attrs()['agent.send.prompt_ms']).toBe('number');
    expect(span.end).not.toHaveBeenCalled();
  });

  it('ends as responded on the first agent message of the claimed turn', () => {
    const events: FoldedStreamEvent[] = [
      { kind: 'new', message: control(0) },
      { kind: 'new', message: userPrompt(1) },
      { kind: 'new', message: agentReply(1) },
    ];
    startSend(SESSION, {
      surface: 'session',
      promptChars: 8,
      attachmentCount: 0,
    });
    observeSend(SESSION, events);

    expect(span.event).toHaveBeenCalledWith('user_message.visible');
    expect(span.event).toHaveBeenCalledWith('agent_message.visible');
    expect(attrs()['agent.send.turn']).toBe(1);
    expect(attrs()['agent.send.outcome']).toBe('responded');
    expect(span.end).toHaveBeenCalledOnce();
    expect(sendTraceFor(SESSION)).toBeUndefined();
  });

  it('ignores an agent message from another turn', () => {
    startSend(SESSION, {
      surface: 'session',
      promptChars: 8,
      attachmentCount: 0,
    });
    observeSend(SESSION, [
      { kind: 'new', message: userPrompt(2) },
      { kind: 'new', message: agentReply(1) },
    ]);

    expect(span.event).toHaveBeenCalledWith('user_message.visible');
    expect(span.event).not.toHaveBeenCalledWith('agent_message.visible');
    expect(span.end).not.toHaveBeenCalled();
  });

  it('reads a replace the same way as streamed news', () => {
    startSend(SESSION, {
      surface: 'session',
      promptChars: 8,
      attachmentCount: 0,
    });
    observeSend(SESSION, [
      { kind: 'replace', messages: [userPrompt(0), agentReply(0)] },
    ]);

    expect(attrs()['agent.send.outcome']).toBe('responded');
  });

  it('keeps the first outcome when end is called twice', () => {
    const trace = startSend(SESSION, {
      surface: 'session',
      promptChars: 1,
      attachmentCount: 0,
    });
    trace.end('failed', 'gone');
    trace.end('responded');

    expect(attrs()['agent.send.outcome']).toBe('failed');
    expect(span.error).toHaveBeenCalledWith('gone');
    expect(span.end).toHaveBeenCalledOnce();
  });

  it('runs work in the send span and opens children from it', () => {
    const trace = startSend(SESSION, {
      surface: 'session',
      promptChars: 1,
      attachmentCount: 0,
    });
    const ran = trace.run(() => 'ok');
    const child = trace.span('agent.session.load');

    expect(ran).toBe('ok');
    expect(span.run).toHaveBeenCalledOnce();
    expect(span.span).toHaveBeenCalledWith('agent.session.load');
    expect(child).toBe(span);
  });

  it('reports a send that never settles as stalled', () => {
    vi.useFakeTimers();
    startSend(SESSION, {
      surface: 'session',
      promptChars: 1,
      attachmentCount: 0,
    });
    vi.advanceTimersByTime(SEND_STALL_THRESHOLD_MS);

    expect(attrs()['agent.send.outcome']).toBe('stalled');
    expect(span.end).toHaveBeenCalledOnce();
  });

  it('swallows span failures so a send cannot throw', () => {
    vi.mocked(Telemetry.span).mockImplementationOnce(() => {
      throw new Error('otel down');
    });

    expect(() =>
      startSend(SESSION, {
        surface: 'session',
        promptChars: 1,
        attachmentCount: 0,
      })
    ).not.toThrow();
    const trace = sendTraceFor(SESSION);
    expect(() => {
      trace?.created();
      trace?.prompted('action-1');
      trace?.observe([{ kind: 'new', message: userPrompt(0) }]);
      trace?.end('failed', 'x');
    }).not.toThrow();
  });
});

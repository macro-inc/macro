import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import {
  needsTrailingWorkingLine,
  showsAwaitingReply,
  showsWorkingLine,
} from './working-line';

const message = (
  author: 'user' | 'agent',
  parts: FoldedMessage['parts'],
  stop: FoldedMessage['stop'] = null
): FoldedMessage =>
  ({
    agentSessionId: 'session',
    turn: 0,
    requestId: null,
    author:
      author === 'user' ? { kind: 'user', userId: null } : { kind: 'agent' },
    parts,
    stop,
  }) as FoldedMessage;

const tool = (status: 'pending' | 'running' | 'completed' | 'failed') =>
  ({
    kind: 'tool_use' as const,
    id: 'tool',
    name: { kind: 'native' as const, name: 'Read' },
    status,
    detail: { kind: 'read' as const, paths: ['a.ts'] },
  }) satisfies FoldedMessage['parts'][number];

describe('showsWorkingLine', () => {
  it('shows on an empty in-flight reply, before thinking begins', () => {
    expect(showsWorkingLine(message('agent', []))).toBe(true);
  });

  it('shows under prose and after a finished tool, so the turn is never silent', () => {
    expect(
      showsWorkingLine(message('agent', [{ kind: 'text', text: 'hello' }]))
    ).toBe(true);
    expect(showsWorkingLine(message('agent', [tool('completed')]))).toBe(true);
    expect(showsWorkingLine(message('agent', [tool('failed')]))).toBe(true);
  });

  it('stays out of the way of a thought, a live tool, or a question', () => {
    expect(
      showsWorkingLine(message('agent', [{ kind: 'thought', text: 'hmm' }]))
    ).toBe(false);
    expect(showsWorkingLine(message('agent', [tool('pending')]))).toBe(false);
    expect(showsWorkingLine(message('agent', [tool('running')]))).toBe(false);
    expect(
      showsWorkingLine(
        message('agent', [
          {
            kind: 'permission',
            toolCall: 'tool',
            options: [],
            outcome: { kind: 'pending' },
          },
        ])
      )
    ).toBe(false);
    expect(
      showsWorkingLine(
        message('agent', [
          {
            kind: 'elicitation',
            requestId: 1,
            toolCall: null,
            message: 'Which one?',
            request: {
              kind: 'url',
              elicitationId: 'e1',
              url: 'https://example.com',
            },
            outcome: { kind: 'pending' },
            reported: null,
            toolOutcome: null,
          },
        ])
      )
    ).toBe(false);
  });
});

describe('showsAwaitingReply', () => {
  const prompt = message('user', [{ kind: 'text', text: 'hi' }]);

  it('hangs the row off the prompt that is still waiting for a reply', () => {
    expect(
      showsAwaitingReply({
        message: prompt,
        lastTurn: prompt,
        working: true,
        blockedOnUser: false,
      })
    ).toBe(true);
  });

  it('does not claim an earlier prompt or a settled session', () => {
    expect(
      showsAwaitingReply({
        message: prompt,
        lastTurn: message('agent', [{ kind: 'text', text: 'ok' }]),
        working: true,
        blockedOnUser: false,
      })
    ).toBe(false);
    expect(
      showsAwaitingReply({
        message: prompt,
        lastTurn: prompt,
        working: false,
        blockedOnUser: false,
      })
    ).toBe(false);
    expect(
      showsAwaitingReply({
        message: prompt,
        lastTurn: prompt,
        working: true,
        blockedOnUser: true,
      })
    ).toBe(false);
  });
});

describe('needsTrailingWorkingLine', () => {
  const settled = message('agent', [{ kind: 'text', text: 'done' }], {
    kind: 'end_turn',
  });
  const prompt = message('user', [{ kind: 'text', text: 'hi' }]);

  it('covers the empty transcript and the gap after send, before the prompt lands', () => {
    expect(
      needsTrailingWorkingLine({
        messages: [],
        working: false,
        sending: true,
        resuming: false,
        blockedOnUser: false,
      })
    ).toBe(true);
    expect(
      needsTrailingWorkingLine({
        messages: [settled],
        working: false,
        sending: true,
        resuming: false,
        blockedOnUser: false,
      })
    ).toBe(true);
    expect(
      needsTrailingWorkingLine({
        messages: [],
        working: false,
        sending: false,
        resuming: true,
        blockedOnUser: false,
      })
    ).toBe(true);
  });

  it('leaves the row on the prompt or the in-flight reply that already owns it', () => {
    expect(
      needsTrailingWorkingLine({
        messages: [prompt],
        working: true,
        sending: false,
        resuming: false,
        blockedOnUser: false,
      })
    ).toBe(false);
    expect(
      needsTrailingWorkingLine({
        messages: [prompt, message('agent', [])],
        working: true,
        sending: false,
        resuming: false,
        blockedOnUser: false,
      })
    ).toBe(false);
  });

  it('stays off when the session is idle or waiting on the reader', () => {
    expect(
      needsTrailingWorkingLine({
        messages: [settled],
        working: false,
        sending: false,
        resuming: false,
        blockedOnUser: false,
      })
    ).toBe(false);
    expect(
      needsTrailingWorkingLine({
        messages: [],
        working: true,
        sending: false,
        resuming: false,
        blockedOnUser: true,
      })
    ).toBe(false);
  });
});

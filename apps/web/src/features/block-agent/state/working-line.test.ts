import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import {
  needsTrailingWorkingLine,
  showsWorkingLine,
  type TrailingWorkingLineInput,
} from './working-line';

const message = (
  author: 'user' | 'agent',
  parts: FoldedMessage['parts'],
  stop: FoldedMessage['stop'] = null
): FoldedMessage =>
  ({
    agentSessionId: 'session',
    turn: 0,
    author:
      author === 'user' ? { kind: 'user', userId: null } : { kind: 'agent' },
    parts,
    stop,
  }) as FoldedMessage;

const idle: TrailingWorkingLineInput = {
  messages: [],
  working: false,
  sending: false,
  pending: false,
  resuming: false,
  blockedOnUser: false,
};

describe('showsWorkingLine', () => {
  it('shows on an empty open reply, before the first thought', () => {
    expect(showsWorkingLine(message('agent', []))).toBe(true);
  });

  it('shows after streamed prose, so a pause before the next thought is not silent', () => {
    expect(
      showsWorkingLine(message('agent', [{ kind: 'text', text: 'Looking.' }]))
    ).toBe(true);
  });

  it('shows after a finished tool, when the next thought has not started', () => {
    expect(
      showsWorkingLine(
        message('agent', [
          {
            kind: 'tool_use',
            id: 't',
            name: { kind: 'native', name: 'Read' },
            status: 'completed',
            detail: { kind: 'read', paths: ['README.md'] },
          },
        ])
      )
    ).toBe(true);
  });

  it('hides while a thought is shimmering', () => {
    expect(
      showsWorkingLine(
        message('agent', [{ kind: 'thought', text: 'Considering the fold.' }])
      )
    ).toBe(false);
  });

  it('hides while the turn is waiting on the reader', () => {
    expect(
      showsWorkingLine(
        message('agent', [
          {
            kind: 'permission',
            toolCall: 't',
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
            message: 'Which?',
            request: { kind: 'unrecognized', mode: 'x', raw: {} },
            outcome: { kind: 'pending' },
            reported: null,
            toolOutcome: null,
          },
        ])
      )
    ).toBe(false);
  });
});

describe('needsTrailingWorkingLine', () => {
  it('shows after a send, before any agent reply exists', () => {
    expect(
      needsTrailingWorkingLine({
        ...idle,
        working: true,
        messages: [message('user', [{ kind: 'text', text: 'hi' }])],
      })
    ).toBe(true);
  });

  it('shows while the prompt is still on the wire', () => {
    expect(needsTrailingWorkingLine({ ...idle, sending: true })).toBe(true);
  });

  it('shows while the session is being created or resumed', () => {
    expect(needsTrailingWorkingLine({ ...idle, pending: true })).toBe(true);
    expect(needsTrailingWorkingLine({ ...idle, resuming: true })).toBe(true);
  });

  it('does not double the row on an in-flight agent reply', () => {
    expect(
      needsTrailingWorkingLine({
        ...idle,
        working: true,
        messages: [message('agent', [{ kind: 'text', text: 'Looking.' }])],
      })
    ).toBe(false);
  });

  it('stays off when the turn is waiting on the reader', () => {
    expect(
      needsTrailingWorkingLine({
        ...idle,
        working: true,
        blockedOnUser: true,
        messages: [message('user', [{ kind: 'text', text: 'hi' }])],
      })
    ).toBe(false);
  });

  it('stays off when nothing is happening', () => {
    expect(needsTrailingWorkingLine(idle)).toBe(false);
  });
});

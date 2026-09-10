import type {
  FoldedMessage,
  MessagePart,
} from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import {
  needsTrailingWorkingLine,
  showsWorkingLine,
} from './shows-working-line';

const message = (
  author: 'user' | 'agent',
  parts: MessagePart[],
  stop: FoldedMessage['stop'] = null
): FoldedMessage =>
  ({
    agentSessionId: 'session',
    requestId: null,
    turn: 0,
    author:
      author === 'user' ? { kind: 'user', userId: null } : { kind: 'agent' },
    parts,
    stop,
  }) as FoldedMessage;

const tool = (
  status: 'pending' | 'running' | 'completed' | 'failed'
): MessagePart => ({
  kind: 'tool_use',
  id: 'tool',
  name: { kind: 'native', name: 'Read' },
  status,
  detail: { kind: 'read', paths: ['README.md'] },
});

describe('showsWorkingLine', () => {
  it('shows on an empty open reply — the fold has not produced a part yet', () => {
    expect(showsWorkingLine(message('agent', []))).toBe(true);
  });

  it('hides while a thought or prose already shows the turn is alive', () => {
    expect(
      showsWorkingLine(message('agent', [{ kind: 'thought', text: 'Hmm' }]))
    ).toBe(false);
    expect(
      showsWorkingLine(message('agent', [{ kind: 'text', text: 'Hello' }]))
    ).toBe(false);
  });

  it('hides while a tool is pending or running, and shows once it finishes', () => {
    expect(showsWorkingLine(message('agent', [tool('pending')]))).toBe(false);
    expect(showsWorkingLine(message('agent', [tool('running')]))).toBe(false);
    expect(showsWorkingLine(message('agent', [tool('completed')]))).toBe(true);
    expect(showsWorkingLine(message('agent', [tool('failed')]))).toBe(true);
  });

  it('hides while a permission, question, or drafted user tool waits on the reader', () => {
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
            message: 'Which?',
            request: { kind: 'unrecognized', mode: 'x', raw: {} },
            outcome: { kind: 'pending' },
            reported: null,
            toolOutcome: null,
          },
        ])
      )
    ).toBe(false);
    expect(
      showsWorkingLine(
        message('agent', [
          {
            kind: 'tool_use',
            id: 'email',
            name: { kind: 'mcp', server: 'macro', tool: 'SendEmail' },
            status: 'completed',
            detail: {
              kind: 'user_tool',
              input: { subject: 'Hi' },
              outcome: { kind: 'pending' },
            },
          },
        ])
      )
    ).toBe(false);
  });

  it('shows after a permission is granted, while the turn is still open', () => {
    expect(
      showsWorkingLine(
        message('agent', [
          {
            kind: 'permission',
            toolCall: 'tool',
            options: [],
            outcome: { kind: 'selected', optionId: 'allow' },
          },
        ])
      )
    ).toBe(true);
  });
});

describe('needsTrailingWorkingLine', () => {
  const prompt = message('user', [{ kind: 'text', text: 'hi' }]);
  const openReply = message('agent', [{ kind: 'thought', text: 'Hmm' }]);
  const settled = message('agent', [{ kind: 'text', text: 'done' }], {
    kind: 'end_turn',
  });

  it('shows after a send, before the fold has minted a reply', () => {
    expect(
      needsTrailingWorkingLine({
        messages: [prompt],
        working: true,
        sending: false,
        blockedOnUser: false,
      })
    ).toBe(true);
    expect(
      needsTrailingWorkingLine({
        messages: [],
        working: false,
        sending: true,
        blockedOnUser: false,
      })
    ).toBe(true);
    expect(
      needsTrailingWorkingLine({
        messages: [settled],
        working: false,
        sending: true,
        blockedOnUser: false,
      })
    ).toBe(true);
  });

  it('does not duplicate the row an in-flight reply already owns', () => {
    expect(
      needsTrailingWorkingLine({
        messages: [prompt, openReply],
        working: true,
        sending: false,
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
        blockedOnUser: false,
      })
    ).toBe(false);
    expect(
      needsTrailingWorkingLine({
        messages: [prompt],
        working: true,
        sending: false,
        blockedOnUser: true,
      })
    ).toBe(false);
  });
});

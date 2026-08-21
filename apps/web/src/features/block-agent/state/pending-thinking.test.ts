import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import { shouldShowPendingThinking } from './pending-thinking';

function message(
  author: 'user' | 'agent',
  parts: FoldedMessage['parts'],
  stop: FoldedMessage['stop'] = null
): FoldedMessage {
  return {
    agentSessionId: 'session',
    requestId: null,
    turn: 0,
    author:
      author === 'user' ? { kind: 'user', userId: null } : { kind: 'agent' },
    parts,
    stop,
  };
}

const busy = { busy: true, messages: [] as FoldedMessage[] };

describe('shouldShowPendingThinking', () => {
  it('hides when the composer is idle', () => {
    expect(
      shouldShowPendingThinking({
        busy: false,
        messages: [message('user', [{ kind: 'text', text: 'hi' }])],
      })
    ).toBe(false);
  });

  it('shows on an empty transcript while a post is in flight', () => {
    expect(shouldShowPendingThinking(busy)).toBe(true);
  });

  it('shows after a user prompt, before the agent has started', () => {
    expect(
      shouldShowPendingThinking({
        busy: true,
        messages: [message('user', [{ kind: 'text', text: 'hi' }])],
      })
    ).toBe(true);
  });

  it('shows after send while the previous turn is still the last row', () => {
    expect(
      shouldShowPendingThinking({
        busy: true,
        messages: [
          message('agent', [{ kind: 'text', text: 'done' }], {
            kind: 'end_turn',
          }),
        ],
      })
    ).toBe(true);
  });

  it('hides once a thought is streaming', () => {
    expect(
      shouldShowPendingThinking({
        busy: true,
        messages: [message('agent', [{ kind: 'thought', text: 'hmm' }])],
      })
    ).toBe(false);
  });

  it('hides once a tool call is visible, even without a thought', () => {
    expect(
      shouldShowPendingThinking({
        busy: true,
        messages: [
          message('agent', [
            {
              kind: 'tool_use',
              id: 't',
              label: 'Read',
              status: 'running',
              detail: { kind: 'read', paths: ['a.ts'] },
            },
          ]),
        ],
      })
    ).toBe(false);
  });
});

import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import { sessionIsWorking } from './session-working';

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

const stopControl: FoldedMessage['parts'] = [
  { kind: 'control', control: { kind: 'stop' }, outcome: { kind: 'accepted' } },
];

describe('sessionIsWorking', () => {
  it('is idle with no messages', () => {
    expect(sessionIsWorking([])).toBe(false);
  });

  it('is working after a user prompt, before the agent starts', () => {
    expect(
      sessionIsWorking([message('user', [{ kind: 'text', text: 'hi' }])])
    ).toBe(true);
  });

  it('is working while the agent has not stopped', () => {
    expect(
      sessionIsWorking([
        message('user', [{ kind: 'text', text: 'hi' }]),
        message('agent', [{ kind: 'text', text: 'working' }]),
      ])
    ).toBe(true);
  });

  it('is idle once the agent stops', () => {
    expect(
      sessionIsWorking([
        message('agent', [{ kind: 'text', text: 'done' }], {
          kind: 'end_turn',
        }),
      ])
    ).toBe(false);
  });

  it('is idle after a stop control — that is the user ending work', () => {
    expect(
      sessionIsWorking([
        message('agent', [{ kind: 'text', text: 'halfway' }]),
        message('user', stopControl),
      ])
    ).toBe(false);
  });

  it('is idle after a model switch', () => {
    expect(
      sessionIsWorking([
        message('user', [
          {
            kind: 'control',
            control: { kind: 'set_model', model: 'opus' },
            outcome: { kind: 'accepted' },
          },
        ]),
      ])
    ).toBe(false);
  });

  it('is working after compact, which starts a turn', () => {
    expect(
      sessionIsWorking([
        message('user', [
          {
            kind: 'control',
            control: { kind: 'compact' },
            outcome: { kind: 'accepted' },
          },
        ]),
      ])
    ).toBe(true);
  });
});

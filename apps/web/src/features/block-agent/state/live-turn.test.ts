import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import { isLiveTurn, liveTurnMessage } from './live-turn';

const agent = (turn: number, stop: FoldedMessage['stop']): FoldedMessage => ({
  agentSessionId: 'session',
  pending: false,
  requestId: null,
  turn,
  author: { kind: 'agent' },
  parts: [{ kind: 'thought', text: 'hm' }],
  stop,
});
const user = (turn: number): FoldedMessage => ({
  agentSessionId: 'session',
  pending: false,
  requestId: null,
  turn,
  author: { kind: 'user', userId: 'u' },
  parts: [{ kind: 'text', text: 'do it' }],
  stop: null,
});
const control = (turn: number): FoldedMessage => ({
  agentSessionId: 'session',
  pending: false,
  requestId: 'r',
  turn,
  author: { kind: 'user', userId: 'u' },
  parts: [
    {
      kind: 'control',
      control: { kind: 'set_model', model: 'x' },
      outcome: { kind: 'accepted' },
    },
  ],
  stop: null,
});

describe('liveTurnMessage', () => {
  it('names the newest agent message while the session is working', () => {
    const tail = agent(1, null);
    expect(
      liveTurnMessage([user(0), agent(0, null), user(1), tail], true)
    ).toBe(tail);
  });

  it('names nothing once the session has stopped working, whatever stop says', () => {
    // A superseded turn keeps `stop: null`; a dead runtime never stamps one.
    expect(liveTurnMessage([user(0), agent(0, null)], false)).toBeUndefined();
  });

  it('names nothing while a prompt is still awaiting its reply', () => {
    expect(
      liveTurnMessage([user(0), agent(0, { kind: 'end_turn' }), user(1)], true)
    ).toBeUndefined();
  });

  it('looks past a trailing control to the turn behind it', () => {
    const tail = agent(0, null);
    expect(liveTurnMessage([user(0), tail, control(1)], true)).toBe(tail);
  });

  it('is empty for an empty transcript', () => {
    expect(liveTurnMessage([], true)).toBeUndefined();
  });
});

describe('isLiveTurn', () => {
  it('matches by turn and author, not identity', () => {
    const live = agent(3, null);
    expect(isLiveTurn({ ...live }, live)).toBe(true);
    expect(isLiveTurn(agent(2, null), live)).toBe(false);
    expect(isLiveTurn(user(3), live)).toBe(false);
  });

  it('is false when nothing is live', () => {
    expect(isLiveTurn(agent(0, null), undefined)).toBe(false);
  });
});

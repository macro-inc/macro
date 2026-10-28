import { describe, expect, it } from 'vitest';
import { agentMessageParams, parseAgentMessageTarget } from './search-location';

describe('agent search locations', () => {
  it.each(['user', 'agent'] as const)(
    'round trips turn zero for %s',
    (author) => {
      const target = { messageTurn: 0, author };
      expect(parseAgentMessageTarget(agentMessageParams(target))).toEqual(
        target
      );
    }
  );
  it.each([
    undefined,
    '',
    '-1',
    '1.5',
    'Infinity',
    '1e2',
    '9007199254740992',
    ['0'],
  ])('ignores invalid turns: %s', (turn) => {
    expect(
      parseAgentMessageTarget({
        agent_message_turn: turn,
        agent_message_author: 'agent',
      })
    ).toBeUndefined();
  });
  it.each([undefined, 'assistant', ['agent']])(
    'ignores invalid authors: %s',
    (author) => {
      expect(
        parseAgentMessageTarget({
          agent_message_turn: '0',
          agent_message_author: author,
        })
      ).toBeUndefined();
    }
  );
});

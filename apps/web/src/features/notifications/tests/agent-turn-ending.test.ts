import { agentTurnEnding } from '@notifications/notification-metadata';
import { describe, expect, it } from 'vitest';

describe('agentTurnEnding', () => {
  it.each([
    ['end_turn', 'finished'],
    ['other', 'finished'],
    ['cancelled', 'was stopped'],
    ['max_tokens', 'hit its limit'],
    ['max_turn_requests', 'hit its limit'],
    ['refusal', 'declined'],
    ['error', 'ran into an error'],
  ] as const)('reads %s as "%s"', (stopReason, ending) => {
    expect(agentTurnEnding(stopReason)).toBe(ending);
  });
});

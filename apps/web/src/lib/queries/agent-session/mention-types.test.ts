import { describe, expect, it } from 'vitest';
import { normalizeAgentSessionStatus } from './mention-types';

describe('agent session mention data', () => {
  it('normalizes GraphQL/Soup statuses without losing unfamiliar events', () => {
    expect(normalizeAgentSessionStatus('no_messages')).toEqual({
      kind: 'no_messages',
    });
    expect(normalizeAgentSessionStatus('disconnected')).toEqual({
      kind: 'disconnected',
    });
    expect(normalizeAgentSessionStatus('session/end')).toEqual({
      kind: 'event',
      event: 'session/end',
    });
  });
});

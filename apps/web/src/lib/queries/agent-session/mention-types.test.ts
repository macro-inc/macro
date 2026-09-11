import { describe, expect, it } from 'vitest';
import {
  type AgentSessionMentionData,
  normalizeAgentSessionStatus,
  searchAgentSessionMentions,
} from './mention-types';

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
  it('searches both persona and session names, preserving recency order', () => {
    const item: AgentSessionMentionData = {
      id: '1',
      name: 'Fix the menu',
      ownerId: 'owner',
      botId: 'bot',
      bot: { id: 'bot', name: 'Ada' },
      status: { kind: 'no_messages' },
      createdAt: '',
      updatedAt: '',
    };
    expect(searchAgentSessionMentions([item], 'ADA menu')).toEqual([item]);
    expect(searchAgentSessionMentions([item], 'missing')).toEqual([]);
    expect(
      searchAgentSessionMentions([{ ...item, bot: null }], 'fix')
    ).toHaveLength(1);
  });
});

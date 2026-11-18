import { describe, expect, it } from 'vitest';
import type { ConversationFacts } from './conversation-filters';
import {
  partitionPhoneConversations,
  startableCustomAgents,
} from './phone-list';
import type { AgentConversationEntity } from './recent-conversations';
import type { RosterAgent } from './roster';

const facts = (state: ConversationFacts['state']): ConversationFacts => ({
  mode: 'chat',
  state,
  unread: false,
  pullRequest: null,
});

describe('phone list', () => {
  it('places waiting before loaded favorites and sorts the remaining rows by update', () => {
    const rows = [
      { id: 'old', type: 'chat', updatedAt: '2024-01-01' },
      { id: 'favorite', type: 'chat', updatedAt: '2024-01-02' },
      { id: 'waiting', type: 'agent_session', updatedAt: '2024-01-03' },
      { id: 'new', type: 'chat', updatedAt: '2024-01-04' },
    ] as AgentConversationEntity[];
    const result = partitionPhoneConversations(
      rows,
      new Set(['chat:favorite', 'agent_session:waiting', 'agent_session:new']),
      (row) => facts(row.id === 'waiting' ? 'waiting' : 'dormant')
    );
    expect(result.waiting.map((row) => row.id)).toEqual(['waiting']);
    expect(result.favorites.map((row) => row.id)).toEqual(['favorite']);
    expect(result.conversations.map((row) => row.id)).toEqual(['new', 'old']);
    expect(rows[0].id).toBe('old');
  });

  it('keeps only available custom agents in roster order', () => {
    const agents = [
      { id: 'system', share: 'system' },
      { id: 'first', share: 'private' },
      { id: 'offline', share: 'private', unavailableReason: 'offline' },
      { id: 'second', share: 'team' },
    ] as RosterAgent[];
    expect(startableCustomAgents(agents).map((agent) => agent.id)).toEqual([
      'first',
      'second',
    ]);
  });
});

import type { AgentSessionSearchResponseItem } from '@service-search/generated/models';
import { describe, expect, it } from 'vitest';
import { mapAgentSessionSearchResult } from './agent-session-search';

const session: AgentSessionSearchResponseItem = {
  id: 'session',
  name: 'Investigation',
  owner_id: 'owner',
  bot_id: 'bot',
  created_at: '2026-09-11T12:00:00Z',
  updated_at: '2026-09-11T13:00:00Z',
  agent_session_search_results: [],
};

describe('agent session search projection', () => {
  it('keeps agent identity separate from legacy chats and supports name-only matches', () => {
    const result = mapAgentSessionSearchResult({
      ...session,
      agent_session_search_results: [
        {
          goto: null,
          score: null,
          highlight: { name: '<macro_em>Investigation</macro_em>' },
        },
      ],
    });
    expect(result).toMatchObject({
      type: 'agent_session',
      id: 'session',
      botId: 'bot',
      ownerId: 'owner',
    });
    expect(result.search.nameHighlight).toBe(
      '<macro_em>Investigation</macro_em>'
    );
    expect(result.search.contentHitData).toBeNull();
  });

  it('preserves each folded message target including turn zero and both authors', () => {
    const result = mapAgentSessionSearchResult({
      ...session,
      agent_session_search_results: [
        {
          goto: { message_turn: 0, author: 'user' },
          score: 2,
          highlight: {
            content: [
              'Find <macro_em>quokka</macro_em>',
              'Another <macro_em>quokka</macro_em>',
            ],
          },
        },
        {
          goto: { message_turn: 0, author: 'agent' },
          score: 1,
          highlight: { content: ['Found <macro_em>quokka</macro_em>'] },
        },
        {
          goto: { message_turn: 7, author: 'agent' },
          score: null,
          highlight: { content: ['Later <macro_em>quokka</macro_em>'] },
        },
      ],
    });
    expect(result.search.contentHitData?.map((hit) => hit.location)).toEqual([
      { type: 'agent', messageTurn: 0, author: 'user' },
      { type: 'agent', messageTurn: 0, author: 'user' },
      { type: 'agent', messageTurn: 0, author: 'agent' },
      { type: 'agent', messageTurn: 7, author: 'agent' },
    ]);
    expect(result.search.contentHitData?.[0].content).toBe(
      'Find <macro_em>quokka</macro_em>'
    );
    expect(result.search.source).toBe('service');
  });
});

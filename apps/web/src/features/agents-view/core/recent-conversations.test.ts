import type { AgentSessionEntity, ChatEntity } from '@entity';
import { describe, expect, it } from 'vitest';
import type { AgentKind } from './agent-kind';
import {
  type AgentConversationEntity,
  botUsage,
  conversationMode,
  groupConversations,
  selectRecentAgentConversations,
} from './recent-conversations';

const OWNER = 'macro|me@example.com';

function session(
  id: string,
  overrides: Partial<AgentSessionEntity> = {}
): AgentSessionEntity {
  return {
    type: 'agent_session',
    id,
    name: `Session ${id}`,
    ownerId: OWNER,
    botId: 'bot-chat',
    status: 'acp_ready',
    updatedAt: '2026-09-15T10:00:00Z',
    ...overrides,
  };
}

function chat(id: string, overrides: Partial<ChatEntity> = {}): ChatEntity {
  return {
    type: 'chat',
    id,
    name: `Chat ${id}`,
    ownerId: OWNER,
    updatedAt: '2026-09-15T09:00:00Z',
    ...overrides,
  };
}

const KINDS: Record<string, AgentKind> = {
  'bot-chat': 'agent',
  'bot-coder': 'coder',
};
const kindOf = (botId: string | undefined) =>
  (botId && KINDS[botId]) || 'agent';

describe('selectRecentAgentConversations', () => {
  it('keeps only the owner’s conversations, newest first, matching the search', () => {
    const mine = session('a', { updatedAt: '2026-09-15T08:00:00Z' });
    const newer = chat('b', { updatedAt: '2026-09-15T11:00:00Z' });
    const theirs = session('c', { ownerId: 'macro|other@example.com' });

    expect(
      selectRecentAgentConversations([mine, theirs, newer], OWNER, '')
    ).toEqual([newer, mine]);
    expect(
      selectRecentAgentConversations([mine, newer], OWNER, 'chat b')
    ).toEqual([newer]);
    expect(selectRecentAgentConversations([mine], undefined, '')).toEqual([]);
  });
});

describe('mixed conversation navigation', () => {
  it('resolves each conversation mode independently of the new composer', () => {
    expect(
      conversationMode(session('code', { botId: 'bot-coder' }), kindOf)
    ).toBe('code');
    expect(conversationMode(session('agent'), kindOf)).toBe('chat');
    expect(conversationMode(chat('plain'), kindOf)).toBe('chat');
    expect(
      conversationMode(session('unknown', { botId: 'unknown' }), kindOf)
    ).toBe('chat');
  });

  it('prefers the bot on the row over the stored bot id', () => {
    expect(
      conversationMode(
        session('x', {
          botId: 'bot-chat',
          bot: { id: 'bot-coder', name: 'Code agent' },
        }),
        kindOf
      )
    ).toBe('code');
  });

  it('keeps chat and coding sessions together in their original date order', () => {
    const rows: AgentConversationEntity[] = [
      session('code', { botId: 'bot-coder' }),
      chat('chat'),
      session('ended', { botId: 'bot-coder', status: 'disconnected' }),
      session('agent'),
    ];
    expect(groupConversations(rows)).toEqual([
      { id: 'recent', label: undefined, conversations: rows },
    ]);
    expect(groupConversations([])).toEqual([]);
  });
});

describe('botUsage', () => {
  it('counts sessions per bot and keeps the newest timestamp', () => {
    const usage = botUsage([
      session('a', { botId: 'bot-coder', updatedAt: '2026-09-15T10:00:00Z' }),
      session('b', { botId: 'bot-coder', updatedAt: '2026-09-14T10:00:00Z' }),
      session('c', {
        botId: 'bot-chat',
        updatedAt: null,
        createdAt: '2026-09-01T00:00:00Z',
      }),
      chat('d'),
    ]);
    expect(usage.get('bot-coder')).toEqual({
      sessions: 2,
      lastUsedAt: Date.parse('2026-09-15T10:00:00Z'),
    });
    expect(usage.get('bot-chat')).toEqual({
      sessions: 1,
      lastUsedAt: Date.parse('2026-09-01T00:00:00Z'),
    });
    expect(usage.has('d')).toBe(false);
  });
});

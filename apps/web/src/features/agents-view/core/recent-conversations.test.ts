import type { AgentSessionEntity, ChatEntity } from '@entity';
import { describe, expect, it } from 'vitest';
import type { AgentKind } from './agent-kind';
import {
  type AgentConversationEntity,
  botUsage,
  conversationsForMode,
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

describe('conversationsForMode', () => {
  const coder = session('coder', { botId: 'bot-coder' });
  const chatAgent = session('agent', { botId: 'bot-chat' });
  const plain = chat('plain');
  const unknown = session('unknown', { botId: 'bot-unknown' });
  const all: AgentConversationEntity[] = [coder, chatAgent, plain, unknown];

  it('shows plain chats and chat-agent sessions in Chat', () => {
    expect(conversationsForMode(all, 'chat', kindOf)).toEqual([
      chatAgent,
      plain,
      unknown,
    ]);
  });

  it('shows coder sessions in Code', () => {
    expect(conversationsForMode(all, 'code', kindOf)).toEqual([coder]);
  });

  it('prefers the bot on the row over the stored bot id', () => {
    const relabeled = session('x', {
      botId: 'bot-chat',
      bot: { id: 'bot-coder', name: 'Coder' },
    });
    expect(conversationsForMode([relabeled], 'code', kindOf)).toEqual([
      relabeled,
    ]);
  });
});

describe('groupConversations', () => {
  it('is empty for nothing', () => {
    expect(groupConversations([], 'chat')).toEqual([]);
    expect(groupConversations([], 'code')).toEqual([]);
  });

  it('keeps Chat as one unlabeled group', () => {
    const rows = [session('a'), chat('b')];
    expect(groupConversations(rows, 'chat')).toEqual([
      { id: 'recent', label: undefined, conversations: rows },
    ]);
  });

  it('splits Code into live and ended sessions', () => {
    const starting = session('s', { status: 'no_messages' });
    const ready = session('r', { status: 'acp_ready' });
    const gone = session('g', { status: 'disconnected' });
    expect(groupConversations([gone, starting, ready], 'code')).toEqual([
      { id: 'active', label: 'Active', conversations: [starting, ready] },
      { id: 'past', label: 'Past', conversations: [gone] },
    ]);
    expect(groupConversations([gone], 'code')).toEqual([
      { id: 'past', label: 'Past', conversations: [gone] },
    ]);
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

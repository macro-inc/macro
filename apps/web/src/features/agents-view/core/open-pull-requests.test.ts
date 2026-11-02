import type { AgentSessionEntity, ChatEntity } from '@entity';
import { describe, expect, it } from 'vitest';
import { selectOpenPullRequests } from './open-pull-requests';
import { conversationMode } from './recent-conversations';

const ownerId = 'macro|me@example.com';

describe('selectOpenPullRequests', () => {
  it('keeps only the owner’s active coding sessions with open or draft PRs, newest first', () => {
    const session: AgentSessionEntity = {
      type: 'agent_session',
      id: 'open',
      name: 'Open PR',
      ownerId,
      botId: 'cursor',
      harness: 'cursor',
      status: 'acp_ready',
      updatedAt: '2026-10-29T10:00:00Z',
      pullRequestState: 'open',
    };
    const draft: AgentSessionEntity = {
      ...session,
      id: 'draft',
      updatedAt: '2026-10-30T10:00:00Z',
      pullRequestState: 'draft',
    };
    const merged: AgentSessionEntity = {
      ...session,
      id: 'merged',
      pullRequestState: 'merged',
    };
    const closed: AgentSessionEntity = {
      ...session,
      id: 'closed',
      pullRequestState: 'closed',
    };
    const archived: AgentSessionEntity = {
      ...session,
      id: 'archived',
      isArchived: true,
    };
    const chatMode: AgentSessionEntity = {
      ...session,
      id: 'chat-mode',
      harness: 'in-memory',
    };
    const otherOwner: AgentSessionEntity = {
      ...session,
      id: 'other-owner',
      ownerId: 'macro|other@example.com',
    };
    const chat: ChatEntity = {
      type: 'chat',
      id: 'chat',
      name: 'Chat',
      ownerId,
    };
    const conversations = [
      session,
      merged,
      chat,
      archived,
      chatMode,
      draft,
      closed,
      otherOwner,
    ];
    const modeForConversation = (
      conversation: (typeof conversations)[number]
    ) => conversationMode(conversation, () => 'agent');

    expect(
      selectOpenPullRequests(conversations, ownerId, modeForConversation)
    ).toEqual([draft, session]);
    expect(conversations[0]).toBe(session);
    expect(
      selectOpenPullRequests(conversations, undefined, modeForConversation)
    ).toEqual([]);
  });
});

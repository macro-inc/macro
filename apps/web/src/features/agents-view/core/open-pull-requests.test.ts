import type { AgentSessionEntity, ChatEntity } from '@entity';
import { describe, expect, it } from 'vitest';
import {
  partitionOpenPullRequests,
  selectOpenPullRequests,
} from './open-pull-requests';
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
      archivedBy: 'pull_request_merged',
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
  it('partitions pinned identities and keeps their original position when pinning is off', () => {
    const open: AgentSessionEntity = {
      type: 'agent_session',
      id: 'open',
      name: 'Open',
      ownerId,
      botId: 'cursor',
      harness: 'cursor',
      status: 'acp_ready',
      pullRequestState: 'open',
    };
    const chat: ChatEntity = {
      type: 'chat',
      id: 'chat',
      name: 'Chat',
      ownerId,
    };
    const rows = [chat, open];
    const mode = (row: (typeof rows)[number]) =>
      conversationMode(row, () => 'agent');
    expect(partitionOpenPullRequests(rows, ownerId, mode)).toEqual({
      openPullRequests: [open],
      conversations: [chat],
    });
    expect(partitionOpenPullRequests(rows, undefined, mode)).toEqual({
      openPullRequests: [],
      conversations: [chat, open],
    });
    expect(rows).toEqual([chat, open]);
  });

  it('retains the selected list order when partitioning pinned rows', () => {
    const older: AgentSessionEntity = {
      type: 'agent_session',
      id: 'older',
      name: 'Older',
      ownerId,
      botId: 'cursor',
      harness: 'cursor',
      status: 'acp_ready',
      pullRequestState: 'open',
      createdAt: '2026-03-01',
      updatedAt: '2026-03-10',
    };
    const newer: AgentSessionEntity = {
      ...older,
      id: 'newer',
      name: 'Newer',
      createdAt: '2026-03-05',
      updatedAt: '2026-03-06',
    };
    expect(
      partitionOpenPullRequests([newer, older], ownerId, () => 'code')
        .openPullRequests
    ).toEqual([newer, older]);
  });
});

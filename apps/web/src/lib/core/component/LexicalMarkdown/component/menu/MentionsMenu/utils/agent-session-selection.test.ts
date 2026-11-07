import type { LexicalEditor } from 'lexical';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { trackMention } = vi.hoisted(() => ({ trackMention: vi.fn() }));
vi.mock('@core/signal/mention', () => ({ trackMention }));
vi.mock('./entityUtils', () => ({ getBlockNameFromEntity: vi.fn(() => 'md') }));
vi.mock('../../../../plugins', () => ({
  REMOVE_INLINE_SEARCH_COMMAND: 'remove-search',
}));
vi.mock('../../../../plugins/mentions', () => ({
  INSERT_AGENT_SESSION_MENTION_COMMAND: 'insert-session',
  INSERT_DOCUMENT_MENTION_COMMAND: 'insert-document',
  INSERT_DATE_MENTION_COMMAND: 'insert-date',
  INSERT_GROUP_MENTION_COMMAND: 'insert-group',
}));
vi.mock('../../../../utils/mentionsUtils', () => ({
  handleUserMention: vi.fn(),
}));

import type { AgentSessionMentionItem } from '../../../../utils/mentionsUtils';
import { createItemHandler } from './mentionHandlers';
import { sortMobileMentions } from './mobileSort';

const item: AgentSessionMentionItem = {
  kind: 'agentSession',
  bucket: 'agent_session',
  sortTimestamp: 0,
  id: 'session',
  searchText: 'Ada Fix mentions',
  timestamps: { createdAt: new Date(), updatedAt: new Date() },
  data: {
    type: 'agent_session',
    id: 'session',
    name: 'Fix mentions',
    ownerId: 'owner',
    botId: 'bot',
    bot: { id: 'bot', name: 'Ada' },
    status: 'no_messages',
    createdAt: '',
    updatedAt: '',
  },
};

describe('agent menu selection', () => {
  it('removes the typed query, reports the agent, and inserts nothing', async () => {
    const dispatchCommand = vi.fn();
    const onAgentMention = vi.fn();
    const onUserMention = vi.fn();
    const handler = createItemHandler({
      editor: { dispatchCommand } as unknown as LexicalEditor,
      onAgentMention,
      onUserMention,
    });
    await handler({
      kind: 'agent',
      id: 'cursor',
      searchText: 'Cursor cursor',
      data: { id: 'bot|cursor', name: 'Cursor' },
    });
    expect(dispatchCommand.mock.calls).toEqual([['remove-search', undefined]]);
    expect(onAgentMention).toHaveBeenCalledWith('cursor');
    expect(onUserMention).not.toHaveBeenCalled();
    expect(trackMention).not.toHaveBeenCalled();
  });
});

describe('agent session menu selection', () => {
  beforeEach(() => {
    trackMention.mockReset();
  });

  it('inserts its own node without invoking user/document attachment callbacks', async () => {
    const dispatchCommand = vi.fn();
    const onDocumentMention = vi.fn();
    const onUserMention = vi.fn();
    const handler = createItemHandler({
      editor: { dispatchCommand } as unknown as LexicalEditor,
      onDocumentMention,
      onUserMention,
    });
    await handler(item);
    expect(dispatchCommand).toHaveBeenNthCalledWith(
      1,
      'remove-search',
      undefined
    );
    expect(dispatchCommand).toHaveBeenNthCalledWith(2, 'insert-session', {
      id: 'session',
      label: 'Fix mentions',
    });
    expect(onDocumentMention).not.toHaveBeenCalled();
    expect(onUserMention).not.toHaveBeenCalled();
    expect(trackMention).not.toHaveBeenCalled();
  });

  it('records a document reference so the session lists the doc under References', async () => {
    trackMention.mockResolvedValue('mention-uuid');
    const dispatchCommand = vi.fn();
    const handler = createItemHandler({
      editor: { dispatchCommand } as unknown as LexicalEditor,
      blockId: 'doc-1',
      blockName: 'write',
    });
    await handler(item);
    expect(trackMention).toHaveBeenCalledWith(
      'doc-1',
      'agent_session',
      'session'
    );
    expect(dispatchCommand).toHaveBeenNthCalledWith(2, 'insert-session', {
      id: 'session',
      label: 'Fix mentions',
      mentionUuid: 'mention-uuid',
    });
  });

  it('does not track when the host is a channel or chat composer', async () => {
    for (const blockName of ['channel', 'chat'] as const) {
      const dispatchCommand = vi.fn();
      const handler = createItemHandler({
        editor: { dispatchCommand } as unknown as LexicalEditor,
        blockId: 'host-1',
        blockName,
      });
      await handler(item);
      expect(trackMention).not.toHaveBeenCalled();
      expect(dispatchCommand).toHaveBeenNthCalledWith(2, 'insert-session', {
        id: 'session',
        label: 'Fix mentions',
      });
    }
  });
  it('participates in the mobile search list', () => {
    expect(sortMobileMentions([item], 'Ada')).toEqual([item]);
  });
});

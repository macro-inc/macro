import type { LexicalEditor } from 'lexical';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@core/signal/mention', () => ({ trackMention: vi.fn() }));
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

describe('agent session menu selection', () => {
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
  });
  it('participates in the mobile search list', () => {
    expect(sortMobileMentions([item], 'Ada')).toEqual([item]);
  });
});

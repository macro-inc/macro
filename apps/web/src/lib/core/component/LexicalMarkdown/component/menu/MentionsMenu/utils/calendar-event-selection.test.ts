import type { LexicalEditor } from 'lexical';
import { expect, it, vi } from 'vitest';

const { trackMention } = vi.hoisted(() => ({ trackMention: vi.fn() }));
vi.mock('@core/signal/mention', () => ({ trackMention }));
// The block table loads every block module; events here never need it.
vi.mock('@core/constant/allBlocks', () => ({ fileTypeToBlockName: vi.fn() }));
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

import { createItemHandler } from './mentionHandlers';

it('inserts a picked event as the calendar mention Copy event pastes', async () => {
  const dispatchCommand = vi.fn();
  const onDocumentMention = vi.fn();
  const handler = createItemHandler({
    editor: { dispatchCommand } as unknown as LexicalEditor,
    blockId: 'channel-1',
    blockName: 'channel',
    onDocumentMention,
  });

  await handler({
    kind: 'calendarEvent',
    id: 'event-1',
    data: {
      eventId: 'event-1',
      title: 'Planning',
      occurrenceKey: '2026-10-26T13:00:00+00:00',
    },
  });

  expect(dispatchCommand).toHaveBeenNthCalledWith(2, 'insert-document', {
    documentId: 'event-1',
    documentName: 'Planning',
    blockName: 'calendar',
    blockParams: { occurrenceKey: '2026-10-26T13:00:00+00:00' },
  });
  expect(trackMention).not.toHaveBeenCalled();
  expect(onDocumentMention).not.toHaveBeenCalled();
});

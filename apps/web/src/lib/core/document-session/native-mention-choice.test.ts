import { expect, test, vi } from 'vitest';
import type { MenuChoice } from './generated/native-bridge';

vi.mock('@core/signal/mention', () => ({
  trackMention: vi.fn(async () => 'fixture-reference'),
}));
vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToBlockName: () => 'unknown',
  verifyBlockName: () => true,
}));

import { createItemHandler } from '../component/LexicalMarkdown/component/menu/MentionsMenu/utils/mentionHandlers';
import { INSERT_USER_MENTION_COMMAND } from '../component/LexicalMarkdown/plugins/mentions';
import type { HandlerDependencies } from '../component/LexicalMarkdown/utils/mentionsUtils';
import { nativeMentionChoice } from './native-mention-choice';

test('actual calendar selection policy retains recurrence identity through the native choice schema', async () => {
  const choices: MenuChoice[] = [];
  const editor: HandlerDependencies['editor'] = {
    dispatchCommand(command, payload) {
      const choice = nativeMentionChoice(command, payload);
      if (choice) choices.push(choice);
      return true;
    },
  };
  await createItemHandler({
    editor,
    blockName: 'channel',
    blockId: 'fixture-document',
  })({
    kind: 'calendarEvent',
    id: 'fixture-event',
    data: {
      eventId: 'fixture-event',
      title: 'Event',
      occurrenceKey: '2026-10-26T13:00:00+00:00',
    },
  });
  expect(choices).toEqual([
    {
      kind: 'document',
      document: {
        documentId: 'fixture-event',
        documentName: 'Event',
        blockName: 'calendar',
        blockParams: { occurrenceKey: '2026-10-26T13:00:00+00:00' },
      },
    },
  ]);
});

test('the schema rejects display-only people instead of accepting a label as their identity', () => {
  expect(() =>
    nativeMentionChoice(INSERT_USER_MENTION_COMMAND, { displayName: 'Person' })
  ).toThrow('Invalid native mention payload');
  expect(
    nativeMentionChoice(INSERT_USER_MENTION_COMMAND, {
      userId: 'fixture-user',
      displayName: 'Person',
      email: 'user@example.com',
      mentionUuid: 'fixture-reference',
    })
  ).toEqual({
    kind: 'user',
    user: {
      userId: 'fixture-user',
      displayName: 'Person',
      email: 'user@example.com',
      mentionUuid: 'fixture-reference',
    },
  });
});

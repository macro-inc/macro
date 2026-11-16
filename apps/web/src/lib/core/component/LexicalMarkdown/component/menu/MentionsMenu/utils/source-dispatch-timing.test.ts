import type { LexicalEditor } from 'lexical';
import { expect, test, vi } from 'vitest';

vi.mock('@core/signal/mention', () => ({ trackMention: vi.fn() }));
vi.mock('../../../../plugins', () => ({
  REMOVE_INLINE_SEARCH_COMMAND: 'remove-search',
}));
vi.mock('../../../../plugins/mentions', () => ({
  INSERT_AGENT_SESSION_MENTION_COMMAND: 'insert-session',
  INSERT_BOOKING_LINK_MENTION_COMMAND: 'insert-booking',
  INSERT_DOCUMENT_MENTION_COMMAND: 'insert-document',
  INSERT_DATE_MENTION_COMMAND: 'insert-date',
  INSERT_GROUP_MENTION_COMMAND: 'insert-group',
}));
vi.mock('../../../../utils/mentionsUtils', () => ({
  handleUserMention: vi.fn(),
}));

import type { MentionItem } from '../../../../utils/mentionsUtils';
import { createItemHandler } from './mentionHandlers';

/** Microtask turns until the handler settles; Source pins this ordering. */
async function settleTicks(item: MentionItem, dispatched: string[]) {
  const dispatchCommand = vi.fn((command: string) => {
    dispatched.push(command);
    return true;
  });
  const handler = createItemHandler({
    editor: { dispatchCommand } as unknown as LexicalEditor,
  });
  let settled = -1;
  const done = handler(item).then(() => {
    settled = ticks;
  });
  let ticks = 0;
  while (settled < 0 && ticks < 20) {
    await Promise.resolve();
    ticks += 1;
  }
  await done;
  return settled;
}

// The values are the Source handler before the shared WithInsertion handlers
// (9df9909f): a synchronous dispatch adds no await of its own.
test.each([
  [
    'group',
    { kind: 'group', id: 'here', data: { id: 'here', groupAlias: 'here' } },
    ['remove-search', 'insert-group'],
    1,
  ],
  [
    'booking link',
    {
      kind: 'bookingLink',
      id: 'b',
      data: { profileId: 'p', slug: 's', title: 'Intro' },
    },
    ['remove-search', 'insert-booking'],
    1,
  ],
  [
    'calendar event',
    { kind: 'calendarEvent', id: 'e', data: { eventId: 'e', title: 'T' } },
    ['remove-search', 'insert-document'],
    1,
  ],
  [
    'external chat',
    { kind: 'externalChat', id: 'c', data: { id: 'c', name: 'Team' } },
    ['remove-search', 'insert-document'],
    1,
  ],
] as const)(
  'Source %s selection keeps its dispatch order and settle timing',
  async (_label, item, commands, ticks) => {
    const dispatched: string[] = [];
    expect(await settleTicks(item as unknown as MentionItem, dispatched)).toBe(
      ticks
    );
    expect(dispatched).toEqual(commands);
  }
);

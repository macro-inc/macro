import type { Message } from '@service-storage/messages';
import { expect, it } from 'vitest';
import { messageToMessageData } from './message-data';

const message: Message = {
  id: 'reply',
  parent: { type: 'document', id: 'doc' },
  thread_id: 'root',
  sender_id: 'bot|00000000-0000-0000-0000-000000000001',
  triggered_by: 'macro|user@example.com',
  bot_profile: { name: 'Researcher', avatar_url: null },
  imported_author: null,
  content: 'Answer',
  mentions: [],
  attachments: [],
  reactions: [],
  created_at: '2026-09-07T00:00:00Z',
  updated_at: '2026-09-07T00:02:00Z',
  edited_at: null,
  deleted_at: null,
};
it('does not treat reaction activity as a content edit in either message surface', () => {
  expect(messageToMessageData(message).edited_at).toBeNull();
});
it('preserves the actual edit time, thread, and bot attribution', () => {
  const edited = { ...message, edited_at: '2026-09-07T00:01:00Z' };
  expect(messageToMessageData(edited)).toMatchObject({
    edited_at: edited.edited_at,
    thread_id: 'root',
    parent: edited.parent,
    sender: { name: 'Researcher', triggered_by: message.triggered_by },
  });
});

it('keeps historical imported attribution in linked conversation rendering', () => {
  const imported = { ...message, imported_author: { name: 'Original author' } };
  expect(messageToMessageData(imported)).toMatchObject({
    parent: imported.parent,
    imported_author: imported.imported_author,
  });
});

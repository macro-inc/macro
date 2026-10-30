import { describe, expect, it } from 'vitest';
import { chat, messages } from '../tests/fake-capabilities';
import { canChangeMessage, composerNote } from './chat';

describe('personal sending identity', () => {
  it('lets a shared viewer read while explaining their missing account', () => {
    expect(
      composerNote({ ...chat, canSend: false, sendReason: 'no_account' })
    ).toBe('Connect your WhatsApp to reply');
    expect(
      composerNote({ ...chat, canSend: false, sendReason: 'not_added' })
    ).toBe("Your WhatsApp isn't in this chat");
    expect(
      composerNote({ ...chat, canSend: false, sendReason: 'not_allowed' })
    ).toBe("Your WhatsApp can't post in this chat");
    expect(composerNote(chat)).toBe('Sending as +14155550142');
  });
  it('offers changes only on own messages inside the server window', () => {
    const own = messages[1];
    const now = Date.parse(own.sentAt) + 5000;
    expect(canChangeMessage(own, chat.ownerId, chat, now, 'edit')).toBe(true);
    expect(canChangeMessage(own, 'another-person', chat, now, 'edit')).toBe(
      false
    );
    expect(
      canChangeMessage(own, chat.ownerId, chat, now + 900000, 'edit')
    ).toBe(false);
    expect(
      canChangeMessage(
        { ...own, deleted: true },
        chat.ownerId,
        chat,
        now,
        'edit'
      )
    ).toBe(false);
    expect(
      canChangeMessage(
        own,
        chat.ownerId,
        { ...chat, canSend: false },
        now,
        'edit'
      )
    ).toBe(false);
  });
});

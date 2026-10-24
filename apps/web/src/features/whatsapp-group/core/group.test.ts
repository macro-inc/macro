import { describe, expect, it } from 'vitest';
import { group, messages } from '../tests/fake-capabilities';
import { canChangeMessage, composerNote } from './group';

describe('personal sending identity', () => {
  it('lets a shared viewer read while explaining their missing account', () => {
    expect(
      composerNote({ ...group, canSend: false, sendReason: 'no_account' })
    ).toBe('Connect your WhatsApp to reply');
    expect(
      composerNote({ ...group, canSend: false, sendReason: 'not_member' })
    ).toBe("Your WhatsApp isn't in this group");
    expect(composerNote(group)).toBe('Sending as +14155550142');
  });
  it('offers changes only on own messages inside the server window', () => {
    const own = messages[1];
    const now = Date.parse(own.sentAt) + 5000;
    expect(canChangeMessage(own, group.ownerId, group, now, 'edit')).toBe(true);
    expect(canChangeMessage(own, 'another-person', group, now, 'edit')).toBe(
      false
    );
    expect(
      canChangeMessage(own, group.ownerId, group, now + 900000, 'edit')
    ).toBe(false);
    expect(
      canChangeMessage(
        { ...own, deleted: true },
        group.ownerId,
        group,
        now,
        'edit'
      )
    ).toBe(false);
    expect(
      canChangeMessage(
        own,
        group.ownerId,
        { ...group, canSend: false },
        now,
        'edit'
      )
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { resolveSendingInbox } from './sending-inbox';

const primary = { id: 'primary', email_address: 'peter@macro.com' };
const alt = { id: 'alt', email_address: 'retep@macro.com' };
const inboxes = [primary, alt];

describe('resolveSendingInbox', () => {
  it('sends a new email from the primary inbox', () => {
    expect(resolveSendingInbox(inboxes, { primaryInboxId: 'primary' })).toBe(
      primary
    );
  });

  it('sends a reply from the inbox that received it', () => {
    expect(
      resolveSendingInbox(inboxes, {
        replyTargetInboxId: 'alt',
        primaryInboxId: 'primary',
      })
    ).toBe(alt);
  });

  it('honours the sender the draft names over the reply target', () => {
    expect(
      resolveSendingInbox(inboxes, {
        draftFrom: 'peter@macro.com',
        replyTargetInboxId: 'alt',
        primaryInboxId: 'primary',
      })
    ).toBe(primary);
  });

  it('matches a named sender whatever its case', () => {
    expect(
      resolveSendingInbox(inboxes, { draftFrom: '  Retep@Macro.com ' })
    ).toBe(alt);
  });

  it('treats a blank sender as no choice at all', () => {
    expect(
      resolveSendingInbox(inboxes, {
        draftFrom: '   ',
        replyTargetInboxId: 'alt',
      })
    ).toBe(alt);
  });

  it("lets the user's own pick win over everything the draft says", () => {
    expect(
      resolveSendingInbox(inboxes, {
        chosenInboxId: 'alt',
        draftFrom: 'peter@macro.com',
        replyTargetInboxId: 'primary',
        primaryInboxId: 'primary',
      })
    ).toBe(alt);
  });

  it('does not replace a user-selected inbox that is no longer connected', () => {
    expect(
      resolveSendingInbox(inboxes, {
        chosenInboxId: 'gone',
        draftFrom: 'gone@macro.com',
        replyTargetInboxId: 'gone',
        primaryInboxId: 'primary',
      })
    ).toBeUndefined();
  });

  it('does not replace an unavailable sender named by the draft', () => {
    expect(
      resolveSendingInbox(inboxes, {
        draftFrom: 'gone@macro.com',
        replyTargetInboxId: 'alt',
        primaryInboxId: 'primary',
      })
    ).toBeUndefined();
  });

  it('waits for the receiving inbox instead of defaulting a reply', () => {
    expect(
      resolveSendingInbox(inboxes, {
        isReply: true,
        primaryInboxId: 'primary',
      })
    ).toBeUndefined();
    expect(
      resolveSendingInbox(inboxes, {
        isReply: true,
        replyTargetInboxId: 'gone',
        primaryInboxId: 'primary',
      })
    ).toBeUndefined();
  });

  it('falls back to any connected inbox when none is the primary', () => {
    // Only delegated inboxes: none of them is the viewer's own primary.
    expect(resolveSendingInbox([alt], {})).toBe(alt);
  });

  it('resolves to nothing when no inbox is connected', () => {
    expect(
      resolveSendingInbox([], { primaryInboxId: 'primary' })
    ).toBeUndefined();
  });
});

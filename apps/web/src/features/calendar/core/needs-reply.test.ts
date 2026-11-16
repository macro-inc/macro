import { describe, expect, it } from 'vitest';
import { NO_VIEWER_CAPABILITIES } from '../types';
import { needsCalendarReply } from './needs-reply';

const invitation = {
  viewerCan: { ...NO_VIEWER_CAPABILITIES, rsvp: true },
  isCancelled: false,
  isSnapshot: false,
  attendees: [
    {
      email: 'viewer@example.com',
      isSelf: true,
      isOrganizer: false,
      isOptional: false,
      responseStatus: 'needs_action' as const,
    },
  ],
};

describe('needsCalendarReply', () => {
  it('includes an actionable unanswered invitation', () => {
    expect(needsCalendarReply(invitation)).toBe(true);
  });

  it.each(['accepted', 'tentative', 'declined'] as const)(
    'excludes the viewer response %s',
    (responseStatus) => {
      expect(
        needsCalendarReply({
          ...invitation,
          attendees: [{ ...invitation.attendees[0], responseStatus }],
        })
      ).toBe(false);
    }
  );

  it('excludes another guest, revoked capabilities, cancellations, and snapshots', () => {
    expect(
      needsCalendarReply({
        ...invitation,
        attendees: [{ ...invitation.attendees[0], isSelf: false }],
      })
    ).toBe(false);
    expect(
      needsCalendarReply({ ...invitation, viewerCan: NO_VIEWER_CAPABILITIES })
    ).toBe(false);
    expect(needsCalendarReply({ ...invitation, isCancelled: true })).toBe(
      false
    );
    expect(needsCalendarReply({ ...invitation, isSnapshot: true })).toBe(false);
  });
});

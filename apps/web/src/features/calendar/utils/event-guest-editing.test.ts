import type { CalendarAttendee } from '@service-storage/generated/schemas/calendarAttendee';
import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../types';
import {
  addedGuestEmails,
  eventGuestEditing,
  GUEST_INVITES_RESTRICTED,
  GUEST_LIST_HIDDEN,
  guestInvitesRestricted,
  guestInvitesRestrictedReason,
  guestListChanged,
  guestListHidden,
} from './event-guest-editing';

function attendee(overrides: Partial<CalendarAttendee>): CalendarAttendee {
  return {
    email: 'guest@example.com',
    isOptional: false,
    isOrganizer: false,
    isSelf: false,
    responseStatus: 'needs_action',
    ...overrides,
  };
}

const ORGANIZER = {
  editDetails: true,
  inviteGuests: true,
  removeGuests: true,
  setGuestPolicy: true,
  rsvp: true,
  organize: true,
};
const MODIFYING_GUEST = {
  editDetails: true,
  inviteGuests: true,
  removeGuests: true,
  setGuestPolicy: false,
  rsvp: true,
  organize: false,
};
const INVITING_GUEST = {
  editDetails: false,
  inviteGuests: true,
  removeGuests: false,
  setGuestPolicy: false,
  rsvp: true,
  organize: false,
};
const GUEST = {
  editDetails: false,
  inviteGuests: false,
  removeGuests: false,
  setGuestPolicy: false,
  rsvp: true,
  organize: false,
};

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: '["event","occurrence"]',
    eventId: 'event',
    occurrenceKey: 'occurrence',
    isCancelled: false,
    isReadOnly: false,
    guestPolicy: {
      canModify: false,
      canInviteOthers: true,
      canSeeOtherGuests: true,
    },
    viewerCan: ORGANIZER,
    attendees: [],
    recurrenceLines: [],
    sourceCalendarIds: [],
    title: 'Sync',
    start: '2026-08-27T19:00:00.000Z',
    end: '2026-08-27T20:00:00.000Z',
    allDay: false,
    calendar: { id: 'cal', name: 'Calendar', color: 'orange' },
    visibleCalendars: [{ id: 'cal', name: 'Calendar', color: 'orange' }],
    ...overrides,
  };
}

const invited = (viewerCan: CalendarEvent['viewerCan']) =>
  event({
    viewerCan,
    attendees: [
      attendee({ email: 'host@example.com', isOrganizer: true }),
      attendee({ email: 'me@example.com', isSelf: true }),
    ],
  });

describe('eventGuestEditing', () => {
  it('lets the organizer replace the guest list whether or not invites are enabled', () => {
    expect(eventGuestEditing(event({ viewerCan: ORGANIZER }), false)).toBe(
      'replace'
    );
    expect(eventGuestEditing(event({ viewerCan: ORGANIZER }), true)).toBe(
      'replace'
    );
  });

  it('lets an Outlook organizer replace the guest list without a guest policy to set', () => {
    expect(
      eventGuestEditing(
        event({ viewerCan: { ...ORGANIZER, setGuestPolicy: false } }),
        true
      )
    ).toBe('replace');
  });

  it('lets a guest who may invite add guests only while invites are enabled', () => {
    expect(eventGuestEditing(invited(INVITING_GUEST), true)).toBe('add');
    expect(eventGuestEditing(invited(INVITING_GUEST), false)).toBe('none');
  });

  it('keeps a guest who may modify the event to adding guests', () => {
    expect(eventGuestEditing(invited(MODIFYING_GUEST), true)).toBe('add');
  });

  it('gives a guest who may not invite a read-only list', () => {
    expect(eventGuestEditing(invited(GUEST), true)).toBe('none');
  });

  it('gives a read-only copy or a team projection a read-only list', () => {
    expect(eventGuestEditing(event({ isReadOnly: true }), true)).toBe('none');
    expect(
      eventGuestEditing(
        event({ teamProjection: { ownerId: 'teammate', kind: 'details' } }),
        true
      )
    ).toBe('none');
  });
});

describe('guestInvitesRestricted', () => {
  it('explains the list of a guest the organizer does not let invite', () => {
    expect(guestInvitesRestricted(invited(GUEST))).toBe(true);
  });

  it('stays quiet for guests who may invite and for the organizer', () => {
    expect(guestInvitesRestricted(invited(INVITING_GUEST))).toBe(false);
    expect(guestInvitesRestricted(invited(ORGANIZER))).toBe(false);
  });

  it('stays quiet when the viewer is not on the event or cannot write to it', () => {
    expect(
      guestInvitesRestricted(
        event({
          viewerCan: GUEST,
          attendees: [attendee({ email: 'host@example.com' })],
        })
      )
    ).toBe(false);
    expect(
      guestInvitesRestricted({ ...invited(GUEST), isReadOnly: true })
    ).toBe(false);
  });

  it('stays quiet on a snapshot, whose only guest is the viewer', () => {
    expect(
      guestInvitesRestricted({
        ...invited({ ...GUEST, rsvp: false }),
        isSnapshot: true,
      })
    ).toBe(false);
  });
});

describe('guestInvitesRestrictedReason', () => {
  const policy = (
    canSeeOtherGuests: boolean,
    canInviteOthers: boolean,
    canModify = false
  ) => ({ canModify, canInviteOthers, canSeeOtherGuests });
  // Google gives a guest's copy of a hidden list only the guest, and the
  // server lets no guest add to it.
  const hiddenFrom = (guestPolicy: CalendarEvent['guestPolicy']) =>
    event({
      guestPolicy,
      viewerCan: GUEST,
      attendees: [attendee({ email: 'me@example.com', isSelf: true })],
    });

  it('blames the hidden guest list when the organizer lets guests invite or modify', () => {
    expect(guestInvitesRestrictedReason(hiddenFrom(policy(false, true)))).toBe(
      GUEST_LIST_HIDDEN
    );
    expect(
      guestInvitesRestrictedReason(hiddenFrom(policy(false, true, true)))
    ).toBe(GUEST_LIST_HIDDEN);
  });

  it('names the organizer when guests may not invite, hidden list or not', () => {
    expect(guestInvitesRestrictedReason(hiddenFrom(policy(false, false)))).toBe(
      GUEST_INVITES_RESTRICTED
    );
    expect(
      guestInvitesRestrictedReason({
        ...invited(GUEST),
        guestPolicy: policy(true, false),
      })
    ).toBe(GUEST_INVITES_RESTRICTED);
  });

  it('says nothing to a guest who may invite', () => {
    expect(guestInvitesRestrictedReason(invited(INVITING_GUEST))).toBe(
      undefined
    );
  });
});

describe('guestListHidden', () => {
  const hidden = {
    canModify: false,
    canInviteOthers: true,
    canSeeOtherGuests: false,
  };

  it('holds for a guest on their own copy of a hidden list', () => {
    expect(guestListHidden({ ...invited(GUEST), guestPolicy: hidden })).toBe(
      true
    );
  });

  it('does not hold for the organizer, who sees every guest', () => {
    expect(
      guestListHidden({ ...invited(ORGANIZER), guestPolicy: hidden })
    ).toBe(false);
  });

  it('does not hold for someone else’s copy or a snapshot', () => {
    expect(
      guestListHidden(
        event({
          viewerCan: GUEST,
          guestPolicy: hidden,
          attendees: [attendee({ email: 'sharer@example.com' })],
        })
      )
    ).toBe(false);
    expect(
      guestListHidden({
        ...invited({ ...GUEST, rsvp: false }),
        guestPolicy: hidden,
        isSnapshot: true,
      })
    ).toBe(false);
  });
});

describe('addedGuestEmails', () => {
  const current = invited(INVITING_GUEST);

  it('returns only the submitted guests the event lacks, in order', () => {
    expect(
      addedGuestEmails(current, [
        'host@example.com',
        'dana@example.com',
        'ada@example.com',
      ])
    ).toEqual(['dana@example.com', 'ada@example.com']);
  });

  it('ignores case, surrounding space, repeats and the viewer', () => {
    expect(
      addedGuestEmails(current, [
        ' HOST@example.com',
        'me@example.com',
        'Dana@example.com',
        'dana@example.com ',
      ])
    ).toEqual(['Dana@example.com']);
  });
});

describe('guestListChanged', () => {
  const organized = event({
    attendees: [
      attendee({ email: 'me@example.com', isOrganizer: true, isSelf: true }),
      attendee({ email: 'teo@example.com' }),
    ],
  });

  it('is false when the submitted list matches the seed', () => {
    expect(
      guestListChanged(organized, ['me@example.com', 'teo@example.com'])
    ).toBe(false);
  });

  it('ignores order and case differences', () => {
    expect(
      guestListChanged(organized, ['TEO@example.com', 'me@example.com'])
    ).toBe(false);
  });

  it('is true when a guest is added', () => {
    expect(
      guestListChanged(organized, [
        'me@example.com',
        'teo@example.com',
        'ada@example.com',
      ])
    ).toBe(true);
  });

  it('is true when a guest is removed', () => {
    expect(guestListChanged(organized, ['me@example.com'])).toBe(true);
  });

  it('does not count the viewer-as-guest against the seed', () => {
    // A non-organizer self attendee is excluded from the seed, so resubmitting
    // the visible guest list alone is not a change.
    expect(guestListChanged(invited(GUEST), ['host@example.com'])).toBe(false);
  });
});

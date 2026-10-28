import type { CalendarMentionEvent } from '@service-calendar/generated/schemas/calendarMentionEvent';
import { describe, expect, it } from 'vitest';
import type { DocumentReference } from './notes-source';
import { resolveReferencePreview } from './reference-preview';

const link: DocumentReference = {
  eventId: 'linked-copy',
  canViewMeeting: true,
  eventTitle: 'Planning',
  occurrenceKey: '2026-10-26T14:00:00+00:00',
};
const preview: CalendarMentionEvent = {
  title: 'Planning',
  viewerEventId: 'viewer-copy',
  time: {
    kind: 'timed',
    startsAt: '2026-10-26T14:00:00Z',
    endsAt: '2026-10-26T15:00:00Z',
  },
  occurrenceKey: link.occurrenceKey,
  isRecurring: true,
  description: null,
  location: null,
  organizerEmail: null,
  organizerName: null,
  attendeeCount: 2,
  updatedAt: '2026-10-25T12:00:00Z',
  canRequestToJoin: false,
};

describe('meeting reference resolution', () => {
  it('never recovers details for an unavailable owner link from a retained preview', () => {
    expect(
      resolveReferencePreview({
        ...link,
        canViewMeeting: false,
        event: preview,
      })
    ).toBeUndefined();
  });
  it('never substitutes another instance for a cancelled linked occurrence', () => {
    expect(
      resolveReferencePreview({ ...link, event: preview })?.event.viewerEventId
    ).toBe('viewer-copy');
    expect(
      resolveReferencePreview({
        ...link,
        event: {
          ...preview,
          occurrenceKey: '2026-10-27T14:00:00+00:00',
        },
      })
    ).toBeUndefined();
    expect(
      resolveReferencePreview({
        ...link,
        event: { ...preview, occurrenceKey: null },
      })
    ).toBeUndefined();
  });

  it('follows a rescheduled one-time meeting but not a conversion into a series', () => {
    const moved = {
      ...preview,
      isRecurring: false,
      occurrenceKey: '2026-10-28T16:00:00+00:00',
    };
    expect(
      resolveReferencePreview({
        ...link,
        occurrenceKey: 'single',
        event: moved,
      })?.event
    ).toBe(moved);
    expect(
      resolveReferencePreview({
        ...link,
        occurrenceKey: 'single',
        event: { ...moved, isRecurring: true },
      })
    ).toBeUndefined();
  });

  it('uses authorized team details without channel-sharing actions or a calendar copy', () => {
    const result = resolveReferencePreview({
      ...link,
      teamEvent: {
        id: 'opaque-team-projection',
        ownerId: 'macro|teammate@example.com',
        time: preview.time,
        contributesToAvailability: true,
        kind: 'details',
        details: {
          title: 'Source-scoped planning',
          description: null,
          location: null,
          conferenceUrl: null,
          organizerEmail: null,
          organizerName: null,
          attendees: [],
          calendarName: 'Work',
        },
      },
    });
    expect(result?.event.title).toBe('Source-scoped planning');
    expect(result?.event.viewerEventId).toBeNull();
    expect(result?.sharedActions).toBe(false);
  });
});

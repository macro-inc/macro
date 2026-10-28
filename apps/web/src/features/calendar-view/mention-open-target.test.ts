import type { PreviewItem } from '@queries/preview/types';
import type { CalendarMentionEvent } from '@service-storage/generated/schemas/calendarMentionEvent';
import { describe, expect, it } from 'vitest';
import { calendarMentionOpen } from './mention-open-target';

const OCCURRENCE = '2026-09-17T21:00:00+00:00';
const OTHER_OCCURRENCE = '2026-09-24T21:00:00+00:00';

function preview(event: Partial<CalendarMentionEvent>): PreviewItem {
  return {
    id: 'mentioned-event',
    type: 'calendar_event',
    access: 'access',
    loading: false,
    rawName: 'Pilates',
    name: 'Pilates',
    event: {
      title: 'Pilates',
      time: {
        kind: 'timed',
        startsAt: '2026-09-17T21:00:00Z',
        endsAt: '2026-09-17T22:00:00Z',
      },
      occurrenceKey: OCCURRENCE,
      isRecurring: true,
      attendeeCount: 2,
      updatedAt: '2026-09-15T00:00:00Z',
      viewerEventId: 'viewer-copy',
      ...event,
    },
  };
}

const noAccess: PreviewItem = {
  id: 'mentioned-event',
  type: 'calendar_event',
  access: 'no_access',
  loading: false,
};

describe('calendarMentionOpen', () => {
  it("opens the viewer's own copy of the meeting", () => {
    const open = calendarMentionOpen(preview({}), 'mentioned-event');

    expect(open).toEqual({
      kind: 'calendar',
      target: {
        eventId: 'viewer-copy',
        occurrenceKey: OCCURRENCE,
        time: {
          kind: 'timed',
          startsAt: '2026-09-17T21:00:00Z',
          endsAt: '2026-09-17T22:00:00Z',
        },
      },
    });
  });

  it('keeps the mention-targeted instance but drops the previewed time', () => {
    const open = calendarMentionOpen(
      preview({}),
      'mentioned-event',
      OTHER_OCCURRENCE
    );

    expect(open).toEqual({
      kind: 'calendar',
      target: {
        eventId: 'viewer-copy',
        occurrenceKey: OTHER_OCCURRENCE,
        time: undefined,
      },
    });
  });

  // A channel member without their own copy sees another member's
  // projection; opening the calendar would target an event they don't have.
  it('is read-only for a channel-shared meeting', () => {
    const shared = preview({ viewerEventId: null });

    expect(calendarMentionOpen(shared, 'mentioned-event')).toEqual({
      kind: 'read_only',
    });
  });

  it('routes an inaccessible mention through the mentioned id', () => {
    expect(
      calendarMentionOpen(noAccess, 'mentioned-event', OCCURRENCE)
    ).toEqual({
      kind: 'calendar',
      target: { eventId: 'mentioned-event', occurrenceKey: OCCURRENCE },
    });
  });
});

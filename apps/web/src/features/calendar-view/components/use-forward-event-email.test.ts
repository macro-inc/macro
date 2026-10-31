/**
 * @vitest-environment jsdom
 */

import {
  type CalendarEvent,
  DEFAULT_GUEST_POLICY,
  NO_VIEWER_CAPABILITIES,
} from '@app/features/calendar/types';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useForwardEventEmail } from './use-forward-event-email';

const mocks = vi.hoisted(() => ({
  openWithSplit: vi.fn(),
  fetchIcs: vi.fn(),
  failure: vi.fn(),
}));

vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: mocks.openWithSplit }),
}));
vi.mock('@queries/calendar/ics', () => ({
  fetchCalendarEventIcs: mocks.fetchIcs,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));

const event: CalendarEvent = {
  id: '["event","occurrence"]',
  eventId: 'event',
  occurrenceKey: 'occurrence',
  isCancelled: false,
  isReadOnly: false,
  guestPolicy: DEFAULT_GUEST_POLICY,
  viewerCan: NO_VIEWER_CAPABILITIES,
  attendees: [],
  recurrenceLines: [],
  sourceCalendarIds: [],
  title: 'Design review',
  start: '2026-10-23T14:00:00.000Z',
  end: '2026-10-23T15:00:00.000Z',
  allDay: false,
  calendar: { id: 'calendar', name: 'Gab', color: 'orange' },
  visibleCalendars: [],
};

beforeEach(() => vi.clearAllMocks());

describe('useForwardEventEmail', () => {
  it('closes the details and opens an unaddressed email with the event file attached', async () => {
    const ics = new Blob(['BEGIN:VCALENDAR'], { type: 'text/calendar' });
    mocks.fetchIcs.mockResolvedValue(ok(ics));
    const closeDetails = vi.fn();

    await useForwardEventEmail()(event, {
      timeFormat: '12-hour',
      closeDetails,
    });

    expect(closeDetails).toHaveBeenCalledOnce();
    expect(mocks.fetchIcs).toHaveBeenCalledWith('event');
    expect(mocks.openWithSplit).toHaveBeenCalledOnce();
    const [content, options] = mocks.openWithSplit.mock.calls[0];
    expect(options).toEqual({ preferNewSplit: true, allowDuplicate: true });
    expect(content.params.initialTo).toBeUndefined();
    expect(content.params.initialSubject).toBe('Design review');
    expect(content.params.initialBodyText).toMatch(/^Design review\nWhen: /);
    const [file] = content.params.initialAttachments;
    expect(file.name).toBe('Design review.ics');
    expect(file.type).toBe('text/calendar');
    expect(file.size).toBe(ics.size);
  });

  it('opens no composer and says so when the event file cannot be fetched', async () => {
    mocks.fetchIcs.mockResolvedValue(err([{ code: 'NOT_FOUND' }]));

    await useForwardEventEmail()(event, {
      timeFormat: '12-hour',
      closeDetails: vi.fn(),
    });

    expect(mocks.failure).toHaveBeenCalledWith('Failed to forward event');
    expect(mocks.openWithSplit).not.toHaveBeenCalled();
  });
});

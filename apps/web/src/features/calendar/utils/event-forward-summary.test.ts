import { describe, expect, it, vi } from 'vitest';
import {
  type CalendarEvent,
  DEFAULT_GUEST_POLICY,
  NO_VIEWER_CAPABILITIES,
} from '../types';
import { eventForwardSummary } from './event-forward-summary';

vi.hoisted(() => {
  process.env.TZ = 'America/New_York';
});

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
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
    calendar: {
      id: 'calendar',
      name: 'Gab',
      color: 'orange',
      emailAddress: 'gab@example.com',
      isPrimary: true,
    },
    visibleCalendars: [],
    ...overrides,
  };
}

describe('eventForwardSummary', () => {
  it('writes the time in the viewer zone with the location, organizer and description as text', () => {
    const summary = eventForwardSummary(
      event({
        location: 'Room 4',
        organizerName: 'Jacob Lee',
        organizerEmail: 'jacob@example.com',
        description:
          '<p>Agenda in <a href="https://example.com/doc">the doc</a></p><ul><li>Scope</li><li>Dates</li></ul>',
      }),
      '12-hour'
    );

    expect(summary).toBe(
      [
        'Design review',
        'When: Fri, October 23 · 10:00 AM–11:00 AM (EDT)',
        'Where: Room 4',
        'Organizer: Jacob Lee <jacob@example.com>',
        '',
        'Agenda in the doc (https://example.com/doc)',
        '- Scope',
        '- Dates',
      ].join('\n')
    );
  });

  it('describes a recurring all-day event without a zone', () => {
    const summary = eventForwardSummary(
      event({
        title: '  ',
        allDay: true,
        start: '2026-10-26',
        end: '2026-10-27',
        recurrenceLines: ['RRULE:FREQ=WEEKLY;BYDAY=MO'],
        description: 'Bring a laptop\nand a charger',
      }),
      '24-hour'
    );

    expect(summary).toBe(
      [
        'Untitled event',
        'When: Mon, October 26 · All day',
        'Repeats: Weekly on Monday',
        '',
        'Bring a laptop',
        'and a charger',
      ].join('\n')
    );
  });

  it('leaves out the guest list and every join link', () => {
    const callUrl = 'https://macro.com/app/meet/AbCdEfGhIjKlMnOpQr';
    const summary = eventForwardSummary(
      event({
        attendees: [
          {
            email: 'guest@example.com',
            displayName: 'Guest Person',
            isOrganizer: false,
            isSelf: false,
            isOptional: false,
            responseStatus: 'accepted',
          },
        ],
        conferenceUrl: 'https://meet.google.com/abc-defg-hij',
        conferenceProvider: 'google_meet',
        location: callUrl,
        description: `<p>Notes</p><p>Join Macro call: <a href="${callUrl}">${callUrl}</a></p>`,
      }),
      '12-hour'
    );

    expect(summary).not.toMatch(/guest|meet\.google|macro\.com\/app\/meet/i);
    expect(summary.endsWith('\n\nNotes')).toBe(true);
  });
});

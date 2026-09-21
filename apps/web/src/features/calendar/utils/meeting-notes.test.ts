import { describe, expect, it } from 'vitest';
import { meetingNotesContent, meetingNotesTitle } from './meeting-notes';

const baseEvent = {
  eventId: 'event-1',
  title: 'Macro Demo Call',
  start: '2026-09-14T15:00:00-04:00',
  occurrenceKey: '2026-09-14T19:00:00+00:00',
  recurrenceLines: [] as string[],
  recurrenceId: undefined,
};

const formattedDate = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
}).format(new Date(baseEvent.start));

describe('meetingNotesTitle', () => {
  it('names the note after the event and the occurrence date', () => {
    expect(meetingNotesTitle(baseEvent)).toBe(
      `Notes on Macro Demo Call ${formattedDate}`
    );
  });

  it('reads an all-day start as a local date', () => {
    const allDayDate = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(2026, 8, 14));
    expect(meetingNotesTitle({ title: 'Offsite', start: '2026-09-14' })).toBe(
      `Notes on Offsite ${allDayDate}`
    );
  });

  it('falls back for an untitled event', () => {
    expect(meetingNotesTitle({ ...baseEvent, title: '  ' })).toBe(
      `Notes on Untitled event ${formattedDate}`
    );
  });
});

describe('meetingNotesContent', () => {
  const mentionOf = (content: string) => {
    const match = /^<m-document-mention>(.*)<\/m-document-mention>/.exec(
      content
    );
    return match ? JSON.parse(match[1]!) : undefined;
  };

  it('starts with a calendar mention of the event', () => {
    expect(mentionOf(meetingNotesContent(baseEvent))).toEqual({
      documentId: 'event-1',
      documentName: 'Macro Demo Call',
      blockName: 'calendar',
      blockParams: {},
    });
  });

  it('pins the occurrence of a recurring event', () => {
    const content = meetingNotesContent({
      ...baseEvent,
      recurrenceLines: ['RRULE:FREQ=WEEKLY'],
    });
    expect(mentionOf(content).blockParams).toEqual({
      occurrenceKey: baseEvent.occurrenceKey,
    });
  });

  it('ends with an empty paragraph after the mention', () => {
    expect(meetingNotesContent(baseEvent)).toMatch(
      /<\/m-document-mention>\n \n$/
    );
  });

  it('keeps a title with quotes and angle brackets intact', () => {
    const title = 'Q3 "<review>" & retro';
    expect(
      mentionOf(meetingNotesContent({ ...baseEvent, title }))
    ).toHaveProperty('documentName', title);
  });
});

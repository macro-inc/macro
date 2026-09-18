import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventEditorSubmitValues } from '../components/composer/event-form-model';
import type { CalendarEvent } from '../types';
import { useEventEditor } from './use-event-editor';

const mocks = vi.hoisted(() => ({
  createEvent: vi.fn(),
  createMeeting: vi.fn(),
  failure: vi.fn(),
  alert: vi.fn(),
  updateEvent: vi.fn(),
  updateMeeting: vi.fn(),
  fetchMeeting: vi.fn(),
}));

vi.mock('@channel/Call/call-link', () => ({
  getMeetingUrl: (token: string) => `https://macro.com/app/meet/${token}`,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure, alert: mocks.alert },
}));
vi.mock('@core/user', () => ({
  useContacts: () => () => [],
  recipientEntityMapper: () => (value: unknown) => value,
}));
vi.mock('@queries/calendar/calendars', () => ({
  useVisibleCalendarsQuery: () => ({ data: [], isSuccess: true }),
}));
vi.mock('@queries/calendar/mutations', () => ({
  useCreateCalendarEventMutation: () => ({
    mutateAsync: mocks.createEvent,
    isPending: false,
  }),
  useUpdateCalendarEventMutation: () => ({
    mutateAsync: mocks.updateEvent,
    isPending: false,
  }),
}));
vi.mock('@queries/call/meetings', () => ({
  useCreateMeetingMutation: () => ({ mutateAsync: mocks.createMeeting }),
  useUpdateMeetingMutation: () => ({ mutateAsync: mocks.updateMeeting }),
  fetchMeeting: mocks.fetchMeeting,
}));

const values: EventEditorSubmitValues = {
  title: 'Planning',
  time: {
    kind: 'timed',
    startsAt: '2026-09-22T14:00:00Z',
    endsAt: '2026-09-22T15:00:00Z',
    timeZone: 'America/New_York',
  },
  location: 'Meeting room',
  description: '<p>Roadmap discussion</p>',
  guestEmails: ['guest@example.com'],
  macroCall: true,
};

const savedEvent: CalendarEvent = {
  id: 'event-1',
  eventId: 'event-1',
  occurrenceKey: '2026-09-22T14:00:00Z',
  isCancelled: false,
  isReadOnly: false,
  attendees: [],
  recurrenceLines: [],
  title: 'Planning',
  start: '2026-09-22T14:00:00Z',
  end: '2026-09-22T15:00:00Z',
  allDay: false,
  sourceCalendarIds: ['calendar-1'],
  calendarId: 'calendar-1',
  calendar: { id: 'calendar-1', name: 'Calendar', color: '#336699' },
  visibleCalendars: [],
  location: 'https://macro.com/app/meet/8m8mGwzHqxzYjeIN5-nJRquRbzyTEhGF',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createEvent.mockResolvedValue({
    id: 'event-1',
    calendarId: 'calendar-1',
  });
  mocks.updateEvent.mockResolvedValue({ id: 'event-1' });
  mocks.createMeeting.mockResolvedValue({
    shareToken: '8m8mGwzHqxzYjeIN5-nJRquRbzyTEhGF',
  });
  mocks.fetchMeeting.mockResolvedValue({ id: 'meeting-1' });
  mocks.updateMeeting.mockResolvedValue({ id: 'meeting-1' });
});

describe('scheduling a Macro call', () => {
  it('creates the calendar event before creating and attaching its call', async () => {
    const saved = vi.fn();
    const [editor, dispose] = createRoot(
      (dispose) =>
        [
          useEventEditor({ event: () => undefined, onSaved: saved }),
          dispose,
        ] as const
    );
    try {
      await editor.save(values);

      expect(mocks.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Planning',
          location: 'Meeting room',
          description: '<p>Roadmap discussion</p>',
        })
      );
      expect(mocks.createEvent.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.createMeeting.mock.invocationCallOrder[0]
      );
      expect(mocks.updateEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'event-1',
          patch: expect.objectContaining({
            location: 'Meeting room',
            description: expect.stringContaining('Join Macro call'),
          }),
        })
      );
      expect(saved).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });

  it('does not create a call when event creation fails', async () => {
    mocks.createEvent.mockRejectedValueOnce(new Error('Calendar unavailable'));
    const [editor, dispose] = createRoot(
      (dispose) =>
        [
          useEventEditor({ event: () => undefined, onSaved: vi.fn() }),
          dispose,
        ] as const
    );
    try {
      await editor.save(values);
      expect(mocks.createMeeting).not.toHaveBeenCalled();
      expect(mocks.failure).toHaveBeenCalledWith('Failed to create event', {
        subtext: 'Calendar unavailable',
      });
    } finally {
      dispose();
    }
  });

  it('retries call creation on the saved event without duplicating the event', async () => {
    mocks.createMeeting.mockRejectedValueOnce(new Error('Call unavailable'));
    const saved = vi.fn();
    const [editor, dispose] = createRoot(
      (dispose) =>
        [
          useEventEditor({ event: () => undefined, onSaved: saved }),
          dispose,
        ] as const
    );
    try {
      await editor.save(values);
      expect(mocks.createEvent).toHaveBeenCalledOnce();
      expect(editor.saveError()).toContain('Your event is saved');
      expect(saved).not.toHaveBeenCalled();
      await editor.save(values);
      expect(mocks.createEvent).toHaveBeenCalledOnce();
      expect(mocks.createMeeting).toHaveBeenCalledTimes(2);
      expect(editor.saveError()).toBeUndefined();
      expect(saved).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });

  it('retains the same call link when attaching it fails and the title changes before retry', async () => {
    mocks.updateEvent.mockRejectedValueOnce(new Error('Update unavailable'));
    const saved = vi.fn();
    const [editor, dispose] = createRoot(
      (dispose) =>
        [
          useEventEditor({ event: () => undefined, onSaved: saved }),
          dispose,
        ] as const
    );
    try {
      await editor.save(values);
      const url = editor.macroCallUrl();
      expect(url).toContain('/meet/');
      expect(editor.saveError()).toContain('Save again to retry');
      expect(saved).not.toHaveBeenCalled();
      await editor.save({ ...values, title: 'Updated planning' });
      expect(mocks.createEvent).toHaveBeenCalledOnce();
      expect(mocks.createMeeting).toHaveBeenCalledOnce();
      expect(mocks.updateMeeting).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Updated planning' })
      );
      expect(mocks.updateEvent.mock.lastCall?.[0].patch.description).toContain(
        url
      );
      expect(saved).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });

  it('guards the whole save flow against concurrent submissions', async () => {
    let finish!: (event: { id: string }) => void;
    mocks.createEvent.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const [editor, dispose] = createRoot(
      (dispose) =>
        [
          useEventEditor({ event: () => undefined, onSaved: vi.fn() }),
          dispose,
        ] as const
    );
    try {
      const saving = editor.save(values);
      expect(editor.pending()).toBe(true);
      await editor.save(values);
      expect(mocks.createEvent).toHaveBeenCalledOnce();
      expect(mocks.createMeeting).not.toHaveBeenCalled();
      finish({ id: 'event-1' });
      await saving;
      expect(editor.pending()).toBe(false);
      expect(mocks.createMeeting).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });

  it('updates an existing event before syncing its saved call', async () => {
    const saved = vi.fn();
    const [editor, dispose] = createRoot(
      (dispose) =>
        [
          useEventEditor({ event: () => savedEvent, onSaved: saved }),
          dispose,
        ] as const
    );
    try {
      await editor.save({ ...values, title: 'Rescheduled planning' });
      expect(mocks.createMeeting).not.toHaveBeenCalled();
      expect(mocks.updateEvent.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.updateMeeting.mock.invocationCallOrder[0]
      );
      expect(mocks.updateMeeting).toHaveBeenCalledWith({
        meetingId: 'meeting-1',
        title: 'Rescheduled planning',
        scheduledStart: '2026-09-22T14:00:00Z',
        scheduledEnd: '2026-09-22T15:00:00Z',
      });
      expect(saved).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });
});

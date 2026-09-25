import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calendarEventToEditorInitialValues,
  type EventEditorSubmitValues,
} from '../components/composer/event-form-model';
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
  quickCalls: true,
  quickCallsLoading: false,
}));

vi.mock('@core/util/webOrigin', () => ({
  getWebOrigin: () => 'https://macro.com',
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
  conferenceChoice: 'macro',
  guestEmails: ['guest@example.com'],
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
  mocks.quickCalls = true;
  mocks.quickCallsLoading = false;
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
  it.each(['off', 'loading'] as const)(
    'saves a calendar event without creating a call when the flag is %s',
    async (state) => {
      mocks.quickCalls = state === 'loading';
      mocks.quickCallsLoading = state === 'loading';
      const saved = vi.fn();
      const [editor, dispose] = createRoot(
        (dispose) =>
          [
            useEventEditor({
              macroCallsEnabled: () =>
                mocks.quickCalls && !mocks.quickCallsLoading,
              event: () => undefined,
              onSaved: saved,
            }),
            dispose,
          ] as const
      );
      try {
        await editor.save(values);
        expect(mocks.createEvent).toHaveBeenCalledOnce();
        expect(mocks.createMeeting).not.toHaveBeenCalled();
        expect(mocks.updateMeeting).not.toHaveBeenCalled();
        expect(saved).toHaveBeenCalledOnce();
      } finally {
        dispose();
      }
    }
  );

  it('rechecks the flag after the calendar save before attaching a call', async () => {
    mocks.createEvent.mockImplementation(async () => {
      mocks.quickCalls = false;
      return { id: 'event-1' };
    });
    const [editor, dispose] = createRoot(
      (dispose) =>
        [
          useEventEditor({
            macroCallsEnabled: () =>
              mocks.quickCalls && !mocks.quickCallsLoading,
            event: () => undefined,
            onSaved: vi.fn(),
          }),
          dispose,
        ] as const
    );
    try {
      await editor.save(values);
      expect(mocks.createMeeting).not.toHaveBeenCalled();
      expect(mocks.updateEvent).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('does not attach an in-flight created call after the flag is disabled', async () => {
    mocks.createMeeting.mockImplementation(async () => {
      mocks.quickCalls = false;
      return { shareToken: '8m8mGwzHqxzYjeIN5-nJRquRbzyTEhGF' };
    });
    const [editor, dispose] = createRoot(
      (dispose) =>
        [
          useEventEditor({
            event: () => undefined,
            onSaved: vi.fn(),
            macroCallsEnabled: () =>
              mocks.quickCalls && !mocks.quickCallsLoading,
          }),
          dispose,
        ] as const
    );
    try {
      await editor.save(values);
      expect(mocks.createMeeting).toHaveBeenCalledOnce();
      expect(mocks.updateEvent).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it.each(['off', 'loading'] as const)(
    'preserves an existing Macro link without syncing it while %s',
    async (state) => {
      mocks.quickCalls = state === 'loading';
      mocks.quickCallsLoading = state === 'loading';
      const [editor, dispose] = createRoot(
        (dispose) =>
          [
            useEventEditor({
              macroCallsEnabled: () =>
                mocks.quickCalls && !mocks.quickCallsLoading,
              event: () => savedEvent,
              onSaved: vi.fn(),
            }),
            dispose,
          ] as const
      );
      try {
        await editor.save(values);
        expect(
          mocks.updateEvent.mock.lastCall?.[0].patch.description
        ).toContain(savedEvent.location);
        expect(mocks.createMeeting).not.toHaveBeenCalled();
        expect(mocks.updateMeeting).not.toHaveBeenCalled();
      } finally {
        dispose();
      }
    }
  );

  it('does not sync a call if the flag is disabled while fetching its details', async () => {
    mocks.fetchMeeting.mockImplementation(async () => {
      mocks.quickCalls = false;
      return { id: 'meeting-1' };
    });
    const [editor, dispose] = createRoot(
      (dispose) =>
        [
          useEventEditor({
            event: () => savedEvent,
            onSaved: vi.fn(),
            macroCallsEnabled: () =>
              mocks.quickCalls && !mocks.quickCallsLoading,
          }),
          dispose,
        ] as const
    );
    try {
      await editor.save(values);
      expect(mocks.fetchMeeting).toHaveBeenCalledOnce();
      expect(mocks.updateMeeting).not.toHaveBeenCalled();
      expect(mocks.updateEvent.mock.lastCall?.[0].patch.description).toContain(
        savedEvent.location
      );
    } finally {
      dispose();
    }
  });

  it.each(['none', 'macro'] as const)(
    'clears legacy provider conferencing when %s is selected on an event carrying both links',
    async (conferenceChoice) => {
      const event = {
        ...savedEvent,
        conferenceUrl: 'https://meet.google.com/abc-defg-hij',
        conferenceProvider: 'google_meet' as const,
      };
      const [editor, dispose] = createRoot(
        (dispose) =>
          [
            useEventEditor({
              macroCallsEnabled: () =>
                mocks.quickCalls && !mocks.quickCallsLoading,
              event: () => event,
              onSaved: vi.fn(),
            }),
            dispose,
          ] as const
      );
      try {
        await editor.save({ ...values, conferenceChoice });
        expect(mocks.updateEvent.mock.calls[0][0].patch.conference).toBe(
          'none'
        );
        expect(mocks.createMeeting).not.toHaveBeenCalled();
        expect(mocks.updateMeeting).toHaveBeenCalledTimes(
          conferenceChoice === 'macro' ? 1 : 0
        );
      } finally {
        dispose();
      }
    }
  );

  it('keeps hidden link content untouched when editing an out-of-office event', async () => {
    const event = { ...savedEvent, eventType: 'out_of_office' as const };
    const [editor, dispose] = createRoot(
      (dispose) =>
        [
          useEventEditor({
            macroCallsEnabled: () =>
              mocks.quickCalls && !mocks.quickCallsLoading,
            event: () => event,
            onSaved: vi.fn(),
          }),
          dispose,
        ] as const
    );
    try {
      const initial = calendarEventToEditorInitialValues(event);
      await editor.save({
        ...values,
        location: initial.location,
        description: initial.description,
        conferenceChoice: 'none',
      });
      expect(mocks.updateEvent.mock.lastCall?.[0].patch.location).toBe(
        event.location
      );
      expect(mocks.updateEvent.mock.lastCall?.[0].patch.description).toBe('');
      expect(mocks.createMeeting).not.toHaveBeenCalled();
      expect(mocks.updateMeeting).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it.each(['none', 'google_meet'] as const)(
    'does not attach a Macro call when %s is selected',
    async (conferenceChoice) => {
      const saved = vi.fn();
      const [editor, dispose] = createRoot(
        (dispose) =>
          [
            useEventEditor({
              macroCallsEnabled: () =>
                mocks.quickCalls && !mocks.quickCallsLoading,
              event: () => undefined,
              onSaved: saved,
            }),
            dispose,
          ] as const
      );
      try {
        await editor.save({
          ...values,
          conferenceChoice,
          ...(conferenceChoice === 'google_meet'
            ? { conference: 'google_meet' }
            : {}),
        });
        expect(mocks.createEvent).toHaveBeenCalledOnce();
        expect(mocks.createEvent.mock.lastCall?.[0].conference).toBe(
          conferenceChoice === 'google_meet' ? 'google_meet' : undefined
        );
        expect(mocks.createMeeting).not.toHaveBeenCalled();
        expect(mocks.updateEvent).not.toHaveBeenCalled();
        expect(saved).toHaveBeenCalledOnce();
      } finally {
        dispose();
      }
    }
  );

  it.each(['none', 'google_meet'] as const)(
    'removes a saved Macro link when changed to %s',
    async (conferenceChoice) => {
      const event = {
        ...savedEvent,
        description: `<p>Roadmap discussion</p><p>Join Macro call: <a href="${savedEvent.location}">${savedEvent.location}</a></p>`,
      };
      const [editor, dispose] = createRoot(
        (dispose) =>
          [
            useEventEditor({
              macroCallsEnabled: () =>
                mocks.quickCalls && !mocks.quickCallsLoading,
              event: () => event,
              onSaved: vi.fn(),
            }),
            dispose,
          ] as const
      );
      try {
        const initial = calendarEventToEditorInitialValues(event);
        expect(initial.conference).toBe('macro');
        await editor.save({
          ...values,
          location: initial.location,
          description: initial.description,
          conferenceChoice,
          conference: conferenceChoice,
        });
        expect(mocks.updateEvent.mock.lastCall?.[0].patch).toEqual(
          expect.objectContaining({
            location: '',
            description: '<p>Roadmap discussion</p>',
            conference: conferenceChoice,
          })
        );
        expect(mocks.createMeeting).not.toHaveBeenCalled();
        expect(mocks.updateMeeting).not.toHaveBeenCalled();
      } finally {
        dispose();
      }
    }
  );

  it('adds a Macro call when an event without a call switches to Macro', async () => {
    const event = { ...savedEvent, location: 'Meeting room' };
    const [editor, dispose] = createRoot(
      (dispose) =>
        [
          useEventEditor({
            macroCallsEnabled: () =>
              mocks.quickCalls && !mocks.quickCallsLoading,
            event: () => event,
            onSaved: vi.fn(),
          }),
          dispose,
        ] as const
    );
    try {
      expect(editor.initialValues()?.conference).toBe('none');
      await editor.save({ ...values, conferenceChoice: 'none' });
      expect(mocks.createMeeting).not.toHaveBeenCalled();
      await editor.save(values);
      expect(mocks.createMeeting).toHaveBeenCalledOnce();
      expect(mocks.updateEvent.mock.lastCall?.[0].patch.description).toContain(
        'Join Macro call'
      );
    } finally {
      dispose();
    }
  });

  it.each(['none', 'disabled'] as const)(
    'saves edited event details after failed attachment when switching to %s',
    async (choice) => {
      mocks.updateEvent.mockRejectedValueOnce(new Error('Update unavailable'));
      const saved = vi.fn();
      const [editor, dispose] = createRoot(
        (dispose) =>
          [
            useEventEditor({
              macroCallsEnabled: () =>
                mocks.quickCalls && !mocks.quickCallsLoading,
              event: () => undefined,
              onSaved: saved,
            }),
            dispose,
          ] as const
      );
      try {
        await editor.save(values);
        expect(editor.saveError()).toBeDefined();
        if (choice === 'disabled') mocks.quickCalls = false;
        await editor.save({
          ...values,
          title: 'Updated planning',
          conferenceChoice: choice === 'none' ? 'none' : 'macro',
        });
        expect(mocks.createEvent).toHaveBeenCalledOnce();
        expect(mocks.createMeeting).toHaveBeenCalledOnce();
        expect(mocks.updateMeeting).not.toHaveBeenCalled();
        expect(mocks.updateEvent.mock.lastCall?.[0].patch.title).toBe(
          'Updated planning'
        );
        expect(mocks.updateEvent.mock.lastCall?.[0].patch.description).toBe(
          values.description
        );
        expect(editor.saveError()).toBeUndefined();
        expect(saved).toHaveBeenCalledOnce();
      } finally {
        dispose();
      }
    }
  );

  it('keeps an all-day call untimed instead of inventing local-midnight times', async () => {
    const [editor, dispose] = createRoot(
      (dispose) =>
        [
          useEventEditor({
            macroCallsEnabled: () =>
              mocks.quickCalls && !mocks.quickCallsLoading,
            event: () => undefined,
            onSaved: vi.fn(),
          }),
          dispose,
        ] as const
    );
    try {
      await editor.save({
        ...values,
        time: {
          kind: 'allDay',
          startDate: '2026-09-22',
          endDate: '2026-09-24',
        },
      });
      expect(mocks.createMeeting).toHaveBeenCalledWith({
        title: 'Planning',
        scheduledStart: null,
        scheduledEnd: null,
      });
    } finally {
      dispose();
    }
  });

  it('does not attach a call to an out-of-office entry', async () => {
    const [editor, dispose] = createRoot(
      (dispose) =>
        [
          useEventEditor({
            macroCallsEnabled: () =>
              mocks.quickCalls && !mocks.quickCallsLoading,
            event: () => undefined,
            onSaved: vi.fn(),
          }),
          dispose,
        ] as const
    );
    try {
      await editor.save({
        ...values,
        outOfOffice: { autoDeclineMode: 'decline_none' },
      });
      expect(mocks.createEvent).toHaveBeenCalledOnce();
      expect(mocks.createMeeting).not.toHaveBeenCalled();
      expect(mocks.updateEvent).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('retains an invited event link without managing another organizer’s call', async () => {
    const event = {
      ...savedEvent,
      attendees: [
        {
          email: 'host@example.com',
          isOrganizer: true,
          isOptional: false,
          isSelf: false,
          responseStatus: 'accepted' as const,
        },
      ],
    };
    const [editor, dispose] = createRoot(
      (dispose) =>
        [
          useEventEditor({
            macroCallsEnabled: () =>
              mocks.quickCalls && !mocks.quickCallsLoading,
            event: () => event,
            onSaved: vi.fn(),
          }),
          dispose,
        ] as const
    );
    try {
      expect(editor.disabledFields()?.conference).toBe(true);
      await editor.save(values);
      expect(mocks.updateEvent.mock.lastCall?.[0].patch.description).toContain(
        savedEvent.location
      );
      expect(mocks.createMeeting).not.toHaveBeenCalled();
      expect(mocks.updateMeeting).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('creates the calendar event before creating and attaching its call', async () => {
    const saved = vi.fn();
    const [editor, dispose] = createRoot(
      (dispose) =>
        [
          useEventEditor({
            macroCallsEnabled: () =>
              mocks.quickCalls && !mocks.quickCallsLoading,
            event: () => undefined,
            onSaved: saved,
          }),
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
          useEventEditor({
            macroCallsEnabled: () =>
              mocks.quickCalls && !mocks.quickCallsLoading,
            event: () => undefined,
            onSaved: vi.fn(),
          }),
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
          useEventEditor({
            macroCallsEnabled: () =>
              mocks.quickCalls && !mocks.quickCallsLoading,
            event: () => undefined,
            onSaved: saved,
          }),
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
          useEventEditor({
            macroCallsEnabled: () =>
              mocks.quickCalls && !mocks.quickCallsLoading,
            event: () => undefined,
            onSaved: saved,
          }),
          dispose,
        ] as const
    );
    try {
      await editor.save(values);
      const linkedDescription =
        mocks.updateEvent.mock.lastCall?.[0].patch.description;
      expect(linkedDescription).toContain('/meet/');
      expect(editor.saveError()).toContain('Save again to retry');
      expect(saved).not.toHaveBeenCalled();
      await editor.save({ ...values, title: 'Updated planning' });
      expect(mocks.createEvent).toHaveBeenCalledOnce();
      expect(mocks.createMeeting).toHaveBeenCalledOnce();
      expect(mocks.updateMeeting).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Updated planning' })
      );
      expect(mocks.updateEvent.mock.lastCall?.[0].patch.description).toBe(
        linkedDescription
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
          useEventEditor({
            macroCallsEnabled: () =>
              mocks.quickCalls && !mocks.quickCallsLoading,
            event: () => undefined,
            onSaved: vi.fn(),
          }),
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

  it('clears the existing meeting schedule when an event becomes all-day', async () => {
    const [editor, dispose] = createRoot(
      (dispose) =>
        [
          useEventEditor({
            event: () => savedEvent,
            onSaved: vi.fn(),
            macroCallsEnabled: () => true,
          }),
          dispose,
        ] as const
    );
    try {
      await editor.save({
        ...values,
        time: {
          kind: 'allDay',
          startDate: '2026-09-22',
          endDate: '2026-09-24',
        },
      });
      expect(mocks.updateMeeting).toHaveBeenCalledWith({
        meetingId: 'meeting-1',
        title: 'Planning',
        scheduledStart: null,
        scheduledEnd: null,
        clearSchedule: true,
      });
    } finally {
      dispose();
    }
  });

  it('updates an existing event before syncing its saved call', async () => {
    const saved = vi.fn();
    const [editor, dispose] = createRoot(
      (dispose) =>
        [
          useEventEditor({
            macroCallsEnabled: () =>
              mocks.quickCalls && !mocks.quickCallsLoading,
            event: () => savedEvent,
            onSaved: saved,
          }),
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

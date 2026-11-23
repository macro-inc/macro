import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventEditorSubmitValues } from '../components/composer/event-form-model';
import { type CalendarEvent, DEFAULT_GUEST_POLICY } from '../types';
import { createStandaloneComposerSetup } from '../views/composer/create-standalone-composer-setup';
import { useEventEditor } from './use-event-editor';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  invite: vi.fn(),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn(), alert: vi.fn() },
}));
vi.mock('@core/user', () => ({
  recipientEntityMapper: () => (value: unknown) => value,
}));
vi.mock('@queries/calendar/calendars', () => ({
  useVisibleCalendarsQuery: () => ({ data: [], isSuccess: true }),
}));
vi.mock('@queries/calendar/mutations', () => ({
  useCreateCalendarEventMutation: () => ({
    mutateAsync: mocks.create,
    isPending: false,
  }),
  useUpdateCalendarEventMutation: () => ({
    mutateAsync: mocks.update,
    isPending: false,
  }),
  useInviteCalendarEventGuestsMutation: () => ({
    mutateAsync: mocks.invite,
    isPending: false,
  }),
  isGuestEditRefused: () => false,
}));
vi.mock('@queries/call/meetings', () => ({
  useCreateMeetingMutation: () => ({ mutateAsync: vi.fn() }),
  useUpdateMeetingMutation: () => ({ mutateAsync: vi.fn() }),
  fetchMeeting: vi.fn(),
}));
vi.mock('@app/observability/flow', () => ({ usePending: vi.fn() }));
vi.mock('./use-calendar-ui-flag', () => ({
  useCalendarGuestInvitesFlag: () => () => false,
  useCalendarInvitationForwardFlag: () => () => false,
}));
vi.mock('./use-synced-calendar-event', () => ({
  useSyncedCalendarEvent: () => () => undefined,
}));
vi.mock('../utils/preferences', () => ({
  useCalendarPreferences: () => [{ timeFormat: '12-hour' }],
}));

const VALUES: EventEditorSubmitValues = {
  title: 'Planning',
  time: {
    kind: 'timed',
    startsAt: '2030-01-01T14:00:00Z',
    endsAt: '2030-01-01T15:00:00Z',
    timeZone: 'America/New_York',
  },
  guestEmails: [],
  location: '',
  description: '',
  conferenceChoice: 'none',
};
const EVENT: CalendarEvent = {
  id: 'event-1',
  eventId: 'event-1',
  occurrenceKey: '2030-01-01T14:00:00Z',
  title: 'Planning',
  start: '2030-01-01T14:00:00Z',
  end: '2030-01-01T15:00:00Z',
  timeZone: 'UTC',
  allDay: false,
  isCancelled: false,
  isReadOnly: false,
  sourceCalendarIds: ['calendar-1'],
  calendarId: 'calendar-1',
  calendar: { id: 'calendar-1', name: 'Calendar', color: '#000000' },
  visibleCalendars: [],
  attendees: [],
  recurrenceLines: [],
  guestPolicy: DEFAULT_GUEST_POLICY,
  visibility: 'default',
  viewerCan: {
    editDetails: true,
    inviteGuests: true,
    removeGuests: true,
    setGuestPolicy: true,
    rsvp: false,
    organize: true,
  },
};

function editorFor(event?: CalendarEvent) {
  return createRoot((dispose) => ({
    editor: useEventEditor({
      event: () => event,
      macroCallsEnabled: () => false,
      onSaved: vi.fn(),
    }),
    dispose,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ id: 'created-event' });
  mocks.update.mockResolvedValue({ id: 'event-1' });
  mocks.invite.mockResolvedValue({ id: 'event-1' });
});

describe('event composer metadata writes', () => {
  it('writes an explicit Busy/Free selection using the existing create API', async () => {
    const { editor, dispose } = editorFor();
    try {
      await editor.save(VALUES, undefined, { transparency: 'transparent' });
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ transparency: 'transparent' })
      );
    } finally {
      dispose();
    }
  });

  it('writes an explicit Busy/Free selection using the existing update API', async () => {
    const { editor, dispose } = editorFor({ ...EVENT, transparency: 'opaque' });
    try {
      await editor.save(VALUES, 'all', { transparency: 'transparent' });
      expect(mocks.update).toHaveBeenCalledWith(
        expect.objectContaining({ patch: { transparency: 'transparent' } })
      );
    } finally {
      dispose();
    }
  });

  it('preserves the saved availability when a legacy caller omits metadata', async () => {
    const { editor, dispose } = editorFor({
      ...EVENT,
      transparency: 'transparent',
    });
    try {
      await editor.save({ ...VALUES, title: 'Updated planning' });
      expect(mocks.update).toHaveBeenCalledWith(
        expect.objectContaining({ patch: { title: 'Updated planning' } })
      );
    } finally {
      dispose();
    }
  });
  it('carries explicit metadata and time-zone-only changes into a conference replacement', () => {
    const { editor, dispose } = editorFor({ ...EVENT, transparency: 'opaque' });
    try {
      const request = editor.replacementRequest(VALUES, 'all', {
        transparency: 'transparent',
        visibility: 'private',
        timeZoneChanged: true,
      });
      expect(request?.changes).toMatchObject({
        transparency: 'transparent',
        visibility: 'private',
        time: VALUES.time,
      });
      expect(request?.changes).not.toHaveProperty('conference');
    } finally {
      dispose();
    }
  });

  it('forwards metadata from the mounted composer model into replacement preparation', () => {
    createRoot((dispose) => {
      try {
        const setup = createStandaloneComposerSetup({
          event: {
            ...EVENT,
            transparency: 'opaque',
            conferenceProvider: 'microsoft_teams',
            conferenceUrl: 'https://teams.microsoft.com/l/meetup-join/example',
          },
          macroCallsEnabled: () => false,
          onClose: vi.fn(),
        });
        setup.model.controller.setField('conference', 'none');
        setup.model.setTransparency('transparent');
        setup.model.setVisibility('private');
        expect(setup.replacementRequest()?.changes).toMatchObject({
          transparency: 'transparent',
          visibility: 'private',
        });
      } finally {
        dispose();
      }
    });
  });
  it('keeps unedited replacement metadata omitted and rejects write-only occurrence visibility', () => {
    const { editor, dispose } = editorFor({
      ...EVENT,
      transparency: 'transparent',
      visibility: 'confidential',
    });
    try {
      const changes = editor.replacementRequest(VALUES, 'all')?.changes;
      expect(changes).not.toHaveProperty('transparency');
      expect(changes).not.toHaveProperty('visibility');
      expect(
        editor.replacementRequest(VALUES, 'this_event', {
          visibility: 'private',
        })
      ).toBeUndefined();
    } finally {
      dispose();
    }
  });

  it('does not send an occurrence visibility change whose readback is unavailable', async () => {
    const { editor, dispose } = editorFor(EVENT);
    try {
      await editor.save(VALUES, 'this_event', { visibility: 'private' });
      expect(mocks.update).not.toHaveBeenCalled();
      expect(editor.saveError()).toBe(
        'Changing visibility for one occurrence is not available.'
      );
      expect(editor.pending()).toBe(false);
    } finally {
      dispose();
    }
  });

  it('includes an explicitly selected visibility on creation', async () => {
    const { editor, dispose } = editorFor();
    try {
      await editor.save(VALUES, undefined, { visibility: 'private' });
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: 'private', time: VALUES.time })
      );
      expect(editor.saveError()).toBeUndefined();
    } finally {
      dispose();
    }
  });

  it('writes an explicit time-zone-only change even when instants are unchanged', async () => {
    const { editor, dispose } = editorFor(EVENT);
    try {
      await editor.save(VALUES, 'all', {
        timeZoneChanged: true,
        visibility: 'private',
      });
      expect(mocks.update).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'event-1',
          patch: { time: VALUES.time, visibility: 'private' },
        })
      );
    } finally {
      dispose();
    }
  });

  it('does not let a guest without detail rights write visibility, time zone, or availability', async () => {
    const { editor, dispose } = editorFor({
      ...EVENT,
      viewerCan: {
        ...EVENT.viewerCan,
        editDetails: false,
        inviteGuests: false,
        removeGuests: false,
        setGuestPolicy: false,
        rsvp: true,
        organize: false,
      },
    });
    try {
      await editor.save(VALUES, 'all', {
        timeZoneChanged: true,
        visibility: 'private',
        transparency: 'transparent',
      });
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });
});

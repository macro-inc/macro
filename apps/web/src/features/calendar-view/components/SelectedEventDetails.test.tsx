/**
 * @vitest-environment jsdom
 */

import type { CalendarEvent } from '@app/features/calendar/types';
import { createSplitAutofocus } from '@components/app/split-layout/utils/createSplitAutofocus';
import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { ImperativeDialogHost } from '@ui';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SelectedEventDetails } from './SelectedEventDetails';

const mocks = vi.hoisted(() => ({
  mobile: false,
  openComposer: vi.fn(),
  openDocument: vi.fn(),
  deleteEvent: vi.fn(),
}));

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => mocks.mobile }));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: mocks.openDocument }),
}));
vi.mock('@queries/calendar/calendars', () => ({
  useVisibleCalendarsQuery: () => ({ isSuccess: true, data: [] }),
}));
vi.mock('@queries/calendar/mutations', () => ({
  useDeleteCalendarEventMutation: () => ({
    mutate: mocks.deleteEvent,
    isPending: false,
  }),
}));
vi.mock(
  '@app/features/calendar-view/components/use-open-event-composer',
  () => ({
    useOpenEventComposer: () => mocks.openComposer,
  })
);
vi.mock(
  '@app/features/calendar-view/components/use-forward-event-email',
  () => ({
    useForwardEventEmail: () => vi.fn(),
  })
);
vi.mock('@app/features/calendar/hooks/create-guest-invite-controller', () => ({
  createGuestInviteController: () => ({ editorOpen: () => false }),
}));
vi.mock('@app/features/calendar/hooks/use-calendar-ui-flag', () => ({
  useCalendarGuestInvitesFlag: () => () => false,
  useCalendarMeetingNotesFlag: () => () => true,
}));
// The sections have their own tests; exercise the overlay's actions and
// navigation/focus handoff here.
vi.mock('@app/features/calendar-notes/calendar-meeting-notes', () => ({
  CalendarMeetingNotes: (props: { onOpenDocument: (id: string) => void }) => (
    <button onClick={() => props.onOpenDocument('note-1')}>
      Open linked note
    </button>
  ),
}));
vi.mock('@app/features/calendar/components/EventDetails', () => ({
  EventDetails: () => null,
}));
vi.mock('@app/features/calendar-view/components/EventGuests', () => ({
  EventGuests: () => null,
}));
vi.mock('@app/features/calendar-view/components/EventJoinRequests', () => ({
  EventJoinRequests: () => null,
}));
vi.mock('@app/features/calendar-view/components/EventRsvpSection', () => ({
  EventRsvpSection: () => null,
}));

// jsdom has no CSS.escape. Closing the confirmation restores focus through a
// selector built from class names, from a timer that can outlive the test.
Object.defineProperty(globalThis, 'CSS', {
  value: {
    escape: (value: string) => value.replace(/[^\w-]/g, (char) => `\\${char}`),
  },
  configurable: true,
});

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const NO_CAPABILITIES = {
  editDetails: false,
  inviteGuests: false,
  removeGuests: false,
  setGuestPolicy: false,
  rsvp: false,
  organize: false,
};

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: '["event-1","2026-10-23T19:00:00Z"]',
    eventId: 'event-1',
    occurrenceKey: '2026-10-23T19:00:00Z',
    isCancelled: false,
    isReadOnly: false,
    guestPolicy: {
      canModify: false,
      canInviteOthers: true,
      canSeeOtherGuests: true,
    },
    viewerCan: NO_CAPABILITIES,
    attendees: [
      {
        email: 'me@example.com',
        isOptional: false,
        isOrganizer: false,
        isSelf: true,
        responseStatus: 'accepted',
      },
    ],
    organizerEmail: 'host@example.com',
    recurrenceLines: [],
    title: 'Projects discussion',
    start: '2026-10-23T19:00:00Z',
    end: '2026-10-23T19:30:00Z',
    allDay: false,
    sourceCalendarIds: ['calendar-1'],
    calendarId: 'calendar-1',
    calendar: { id: 'calendar-1', name: 'Calendar', color: '#336699' },
    visibleCalendars: [],
    ...overrides,
  };
}

function showDetails(selected: CalendarEvent) {
  const boundary = document.createElement('div');
  const anchor = document.createElement('button');
  const [selection, setSelection] = createSignal<CalendarEvent | undefined>(
    selected
  );
  anchor.textContent = 'Open event details';
  anchor.onclick = () => setSelection(selected);
  document.body.append(boundary, anchor);
  render(() => (
    <>
      <SelectedEventDetails
        boundary={boundary}
        anchor={() => anchor}
        event={selection}
        timeFormat={() => '12-hour'}
        onClose={() => setSelection(undefined)}
      />
      <ImperativeDialogHost />
    </>
  ));
  return anchor;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', ObserverStub);
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('desktop focus handoff', () => {
  beforeEach(() => {
    mocks.mobile = false;
  });

  it('lets a note that finishes mounting after dismissal claim focus', async () => {
    const user = userEvent.setup();
    const anchor = showDetails(event());
    const [noteElement, setNoteElement] = createSignal<HTMLElement | null>(
      null
    );
    render(() => {
      createSplitAutofocus({ element: noteElement, enabled: () => true });
      return null;
    });

    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await user.click(anchor);
      await user.click(
        screen.getByRole('button', { name: 'Open linked note' })
      );
      expect(mocks.openDocument).toHaveBeenCalledWith(
        { type: 'md', id: 'note-1' },
        { preferNewSplit: true }
      );

      const note = document.createElement('div');
      note.tabIndex = -1;
      document.body.append(note);
      setNoteElement(note);
      await Promise.resolve();
      expect(document.activeElement).toBe(note);
    }
  });

  it('returns focus to the event on ordinary dismissal and reopening', async () => {
    const user = userEvent.setup();
    const anchor = showDetails(event());

    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await user.click(anchor);
      await user.click(
        screen.getByRole('button', { name: 'Close event details' })
      );
      expect(document.activeElement).toBe(anchor);
    }
  });
});

describe.each([
  ['desktop popover', false],
  ['phone drawer', true],
])('in the %s', (_surface, mobile) => {
  beforeEach(() => {
    mocks.mobile = mobile;
  });

  it('offers no Edit on a snapshot, and deletes it as the viewer’s copy', async () => {
    const user = userEvent.setup();
    showDetails(event({ isSnapshot: true }));

    const deleteCopy = await screen.findByRole('button', {
      name: 'Delete your copy',
    });
    expect(screen.queryByRole('button', { name: 'Edit event' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete event' })).toBeNull();

    await user.click(deleteCopy);
    expect(
      await screen.findByText(
        'Delete your copy of “Projects discussion”? The shared event stays as it is.'
      )
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(mocks.deleteEvent).toHaveBeenCalledWith({
      eventId: 'event-1',
      calendarId: 'calendar-1',
      scope: 'all',
      recurrenceId: undefined,
      occurrenceKey: undefined,
    });
  });

  it('promises no notifications when deleting an event nobody else is on', async () => {
    const user = userEvent.setup();
    showDetails(event({ viewerCan: { ...NO_CAPABILITIES, organize: true } }));

    await user.click(
      await screen.findByRole('button', { name: 'Delete event' })
    );
    expect(
      await screen.findByText('Delete “Projects discussion”?')
    ).toBeTruthy();
    expect(screen.queryByText(/Guests will be notified/)).toBeNull();
  });

  it('keeps Edit for a guest the organizer does not let modify', async () => {
    showDetails(event({ viewerCan: { ...NO_CAPABILITIES, rsvp: true } }));

    expect(
      await screen.findByRole('button', { name: 'Edit event' })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete event' })).toBeTruthy();
  });
});

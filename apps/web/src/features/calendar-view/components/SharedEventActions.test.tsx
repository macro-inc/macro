/**
 * @vitest-environment jsdom
 */

import type { VisibleCalendar } from '@service-calendar/generated/schemas/visibleCalendar';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SharedEventActions } from './SharedEventActions';

const mocks = vi.hoisted(() => ({
  addSharedEvent: true,
  calendars: [] as VisibleCalendar[],
  copy: vi.fn(),
  ask: vi.fn(),
  download: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: mocks.success, failure: mocks.failure },
}));
vi.mock('@app/features/calendar-view/download-event-ics', () => ({
  downloadCalendarEventIcs: mocks.download,
}));
vi.mock('@app/features/calendar/hooks/use-calendar-ui-flag', () => ({
  useCalendarAddSharedEventFlag: () => () => mocks.addSharedEvent,
}));
vi.mock('@queries/calendar/calendars', () => ({
  useVisibleCalendarsQuery: () => ({ isPending: false, data: mocks.calendars }),
}));
// The mutation's transport and cache invalidation are covered with the
// query; here it answers with whatever `mocks.copy` returns or throws.
vi.mock('@queries/calendar/copy', () => ({
  isAlreadyOnCalendar: (error: unknown) =>
    (error as { code?: string }).code === 'already_on_calendar',
  isCopyRefused: (error: unknown) =>
    (error as { code?: string }).code === 'copy_refused',
  isJoinRequestOpen: (error: unknown) =>
    (error as { code?: string }).code === 'join_request_open',
  useCopySharedCalendarEventMutation: (callbacks?: {
    onSuccess?: () => void;
    onError?: (error: unknown) => void;
  }) => ({
    isPending: false,
    mutate: (args: { eventId: string; calendarId?: string }) => {
      try {
        mocks.copy(args);
        callbacks?.onSuccess?.();
      } catch (error) {
        callbacks?.onError?.(error);
      }
    },
  }),
}));

vi.mock('@queries/calendar/join-requests', () => ({
  isSharerCannotInvite: (error: unknown) =>
    (error as { code?: string }).code === 'sharer_cannot_invite',
  isJoinRequestDeclined: (error: unknown) =>
    (error as { code?: string }).code === 'request_declined',
  useRequestToJoinCalendarEventMutation: (callbacks?: {
    onSuccess?: () => void;
    onError?: (error: unknown) => void;
  }) => ({
    isPending: false,
    mutate: (eventId: string) => {
      try {
        mocks.ask(eventId);
        callbacks?.onSuccess?.();
      } catch (error) {
        callbacks?.onError?.(error);
      }
    },
  }),
}));

function calendar(overrides: Partial<VisibleCalendar>): VisibleCalendar {
  return {
    id: 'calendar-primary',
    emailLinkId: 'link-1',
    emailAddress: 'member@example.com',
    name: 'member@example.com',
    provider: 'google',
    capabilities: {
      autoDecline: true,
      customRecurrence: true,
      emailReminders: true,
      guestPolicy: true,
      removeConference: true,
      resetRsvp: true,
    },
    color: null,
    isPrimary: true,
    isWritable: true,
    isSubscription: false,
    syncError: null,
    defaultReminders: [],
    ...overrides,
  };
}

function renderActions(
  join: Partial<{
    canRequestToJoin: boolean;
    joinRequestStatus: 'pending' | 'accepted' | 'declined';
  }> = {}
) {
  render(() => (
    <SharedEventActions
      eventId="shared-event"
      title="Design review"
      canRequestToJoin={join.canRequestToJoin ?? false}
      joinRequestStatus={join.joinRequestStatus}
    />
  ));
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('scrollTo', vi.fn());
  mocks.addSharedEvent = true;
  mocks.calendars = [];
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('shared event actions', () => {
  it('adds the event to the only Google calendar the viewer can write to', () => {
    mocks.calendars = [
      calendar({}),
      calendar({ id: 'holidays', isWritable: false, isSubscription: true }),
      calendar({ id: 'outlook', provider: 'outlook', isPrimary: false }),
    ];
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Add to calendar' }));

    expect(mocks.copy).toHaveBeenCalledWith({
      eventId: 'shared-event',
      calendarId: 'calendar-primary',
    });
    expect(mocks.success).toHaveBeenCalledWith('Added to your calendar');
  });

  it('lets the viewer pick among several Google calendars', async () => {
    mocks.calendars = [
      calendar({}),
      calendar({
        id: 'calendar-team',
        name: 'Team',
        isPrimary: false,
      }),
      calendar({ id: 'outlook', name: 'Outlook', provider: 'outlook' }),
    ];
    renderActions();

    fireEvent.keyDown(screen.getByRole('button', { name: 'Add to calendar' }), {
      key: 'Enter',
    });
    const options = await screen.findAllByRole('menuitem');
    expect(options.map((option) => option.textContent)).toEqual([
      'member@example.com',
      'Teammember@example.com',
    ]);
    fireEvent.keyDown(options[1], { key: 'Enter' });

    expect(mocks.copy).toHaveBeenCalledWith({
      eventId: 'shared-event',
      calendarId: 'calendar-team',
    });
  });

  it('cannot add without a writable Google calendar but can still download', () => {
    mocks.calendars = [calendar({ provider: 'outlook' })];
    renderActions();

    const add = screen.getByRole('button', { name: 'Add to calendar' });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Download .ics' }));
    expect(mocks.download).toHaveBeenCalledWith({
      eventId: 'shared-event',
      title: 'Design review',
    });
  });

  it('says so when the meeting is already on a calendar', () => {
    mocks.calendars = [calendar({})];
    mocks.copy.mockImplementation(() => {
      throw { code: 'already_on_calendar' };
    });
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Add to calendar' }));

    expect(mocks.failure).toHaveBeenCalledWith(
      'This event is already on your calendar'
    );
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('says when Google refuses the copy and points to the download', () => {
    mocks.calendars = [calendar({})];
    mocks.copy.mockImplementation(() => {
      throw { code: 'copy_refused' };
    });
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Add to calendar' }));

    expect(mocks.failure).toHaveBeenCalledWith(
      "Google Calendar won't add this event to that calendar",
      { subtext: 'Download the .ics file to add it another way.' }
    );
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('offers only the download while adding shared events is flagged off', () => {
    mocks.addSharedEvent = false;
    mocks.calendars = [calendar({})];
    renderActions();

    expect(
      screen.queryByRole('button', { name: 'Add to calendar' })
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Download .ics' }));
    expect(mocks.download).toHaveBeenCalledOnce();
  });

  it('asks the sharer to add the viewer and shows the request as sent', () => {
    renderActions({ canRequestToJoin: true });

    fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));

    expect(mocks.ask).toHaveBeenCalledWith('shared-event');
    expect(screen.queryByRole('button', { name: 'Ask to join' })).toBeNull();
    expect(screen.getByText('Requested')).toBeTruthy();
  });

  it('lets the stored answer replace the sent state', () => {
    const [status, setStatus] = createSignal<
      'pending' | 'accepted' | 'declined' | undefined
    >();
    render(() => (
      <SharedEventActions
        eventId="shared-event"
        title="Design review"
        canRequestToJoin
        joinRequestStatus={status()}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    expect(screen.getByText('Requested')).toBeTruthy();

    setStatus('accepted');
    expect(screen.getByText('Invited')).toBeTruthy();
    expect(screen.queryByText('Requested')).toBeNull();
  });

  it('says a request was declined and offers no second ask', () => {
    const [status, setStatus] = createSignal<'pending' | 'declined'>();
    render(() => (
      <SharedEventActions
        eventId="shared-event"
        title="Design review"
        canRequestToJoin
        joinRequestStatus={status()}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    setStatus('pending');
    expect(screen.getByText('Requested')).toBeTruthy();

    // Even a preview that still says the viewer may ask stops offering it.
    setStatus('declined');
    expect(screen.getByText('Declined')).toBeTruthy();
    expect(
      screen.getByText(
        'The person who shared this event declined your request to join.'
      )
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ask to join' })).toBeNull();
    expect(screen.queryByText('Requested')).toBeNull();
    expect(
      screen.queryByText(
        "The person who shared this event can't add guests to it."
      )
    ).toBeNull();
    expect(mocks.ask).toHaveBeenCalledOnce();
  });

  it('says so when the sharer already declined an ask the card still offered', () => {
    mocks.ask.mockImplementationOnce(() => {
      throw { code: 'request_declined' };
    });
    renderActions({ canRequestToJoin: true });

    fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));

    expect(mocks.failure).toHaveBeenCalledWith(
      'The person who shared this event declined your request'
    );
    expect(screen.queryByText('Requested')).toBeNull();
  });

  it('lets neither a pending nor an invited viewer ask again', () => {
    renderActions({
      canRequestToJoin: true,
      joinRequestStatus: 'pending',
    });
    expect(screen.queryByRole('button', { name: 'Ask to join' })).toBeNull();
    cleanup();

    renderActions({
      canRequestToJoin: true,
      joinRequestStatus: 'accepted',
    });
    expect(screen.queryByRole('button', { name: 'Ask to join' })).toBeNull();
    expect(screen.getByText('Invited')).toBeTruthy();
  });

  it('offers no Add to calendar while a request to join is outstanding', () => {
    mocks.calendars = [calendar({})];
    const [status, setStatus] = createSignal<
      'pending' | 'accepted' | 'declined' | undefined
    >();
    render(() => (
      <SharedEventActions
        eventId="shared-event"
        title="Design review"
        canRequestToJoin
        joinRequestStatus={status()}
      />
    ));
    const addButton = () =>
      screen.queryByRole('button', { name: 'Add to calendar' });
    expect(addButton()).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    expect(addButton()).toBeNull();
    expect(screen.getByRole('button', { name: 'Download .ics' })).toBeTruthy();

    setStatus('pending');
    expect(addButton()).toBeNull();

    setStatus('accepted');
    expect(addButton()).toBeNull();

    setStatus('declined');
    expect(addButton()).toBeTruthy();
  });

  it('explains instead of offering to ask when the sharer cannot add guests', () => {
    renderActions({ canRequestToJoin: false });

    expect(screen.queryByRole('button', { name: 'Ask to join' })).toBeNull();
    expect(
      screen.getByText(
        "The person who shared this event can't add guests to it."
      )
    ).toBeTruthy();
  });
});

/**
 * @vitest-environment jsdom
 */

import { createGuestInviteController } from '@app/features/calendar/hooks/create-guest-invite-controller';
import type { CalendarEvent } from '@app/features/calendar/types';
import type { CalendarAttendee } from '@service-storage/generated/schemas/calendarAttendee';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventGuests } from './EventGuests';

const mocks = vi.hoisted(() => ({
  invite: vi.fn(),
  forward: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
  alert: vi.fn(),
}));

vi.mock('@core/component/UserIcon', () => ({
  UserIcon: () => document.createElement('span'),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: {
    success: mocks.success,
    failure: mocks.failure,
    alert: mocks.alert,
  },
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('./use-open-event-email', () => ({ useOpenEventEmail: () => vi.fn() }));
vi.mock('@core/user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/user')>()),
  useContacts: () => () => [
    {
      id: 'macro|ada@example.com',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
    },
    {
      id: 'macro|grace@example.com',
      email: 'grace@example.com',
      name: 'Grace Hopper',
    },
  ],
}));
vi.mock('@queries/calendar/mutations', () => ({
  useInviteCalendarEventGuestsMutation: () => ({ mutateAsync: mocks.invite }),
  isGuestInviteRefused: (error: unknown) =>
    (error as { code?: string }).code === 'guests_cannot_invite',
  isGuestListHiddenRefusal: (error: unknown) =>
    (error as { code?: string }).code === 'guest_list_hidden',
}));
vi.mock('@queries/calendar/forward', () => ({
  useForwardCalendarEventMutation: () => ({ mutateAsync: mocks.forward }),
  isForwardRecipientRefusal: (error: unknown) =>
    (error as { code?: string }).code === 'invalid_recipients',
}));
// The picker itself is the composer's and is tested there; this stand-in
// offers every pool member it is not told to exclude.
vi.mock('@property/editors/selectors/PropertyEntitySelector', async () => {
  const { createRenderEffect } = await import('solid-js');
  return {
    PropertyEntitySelector: (props: {
      config: {
        placeholder: string;
        users?: () => { id: string; name: string }[];
        excludedIds?: () => ReadonlySet<string>;
      };
      selectedOptions: () => Set<string>;
      setSelectedOptions: (ids: Set<string>) => void;
      onClose?: () => void;
    }) => {
      const root = document.createElement('div');
      const input = document.createElement('input');
      input.type = 'text';
      input.setAttribute('aria-label', 'Search for guests');
      input.placeholder = props.config.placeholder;
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') props.onClose?.();
      });
      const suggestions = document.createElement('div');
      root.append(input, suggestions);
      createRenderEffect(() => {
        const excluded = props.config.excludedIds?.() ?? new Set();
        suggestions.replaceChildren(
          ...(props.config.users?.() ?? [])
            .filter((user) => !excluded.has(user.id))
            .map((user) => {
              const option = document.createElement('button');
              option.type = 'button';
              option.textContent = `Suggest ${user.name}`;
              option.addEventListener('click', () =>
                props.setSelectedOptions(
                  new Set([...props.selectedOptions(), user.id])
                )
              );
              return option;
            })
        );
      });
      return root;
    },
  };
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function attendee(overrides: Partial<CalendarAttendee>): CalendarAttendee {
  return {
    email: 'guest@example.com',
    isOptional: false,
    isOrganizer: false,
    isSelf: false,
    responseStatus: 'accepted',
    ...overrides,
  };
}

const MAY_INVITE = {
  editDetails: false,
  inviteGuests: true,
  removeGuests: false,
  setGuestPolicy: false,
  rsvp: true,
  organize: false,
};

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: '["event-1","2026-10-22T14:00:00Z"]',
    eventId: 'event-1',
    occurrenceKey: '2026-10-22T14:00:00Z',
    isCancelled: false,
    isReadOnly: false,
    guestPolicy: {
      canModify: false,
      canInviteOthers: true,
      canSeeOtherGuests: true,
    },
    viewerCan: MAY_INVITE,
    attendees: [
      attendee({ email: 'host@example.com', isOrganizer: true }),
      attendee({ email: 'me@example.com', isSelf: true }),
    ],
    recurrenceLines: [],
    sourceCalendarIds: ['calendar-1'],
    calendarId: 'calendar-1',
    title: 'Planning',
    start: '2026-10-22T14:00:00Z',
    end: '2026-10-22T15:00:00Z',
    allDay: false,
    calendar: { id: 'calendar-1', name: 'Calendar', color: 'orange' },
    visibleCalendars: [],
    ...overrides,
  };
}

function renderGuests(
  current: CalendarEvent,
  invitesEnabled = true,
  forwardEnabled = true
) {
  render(() => {
    const invites = createGuestInviteController(
      () => current,
      () => invitesEnabled,
      () => forwardEnabled
    );
    return (
      <EventGuests event={current} invites={invites} closeDetails={vi.fn()} />
    );
  });
}

const RESTRICTED = 'Only the organizer can invite guests.';
const HIDDEN =
  'Guests cannot be added while the organizer hides the guest list.';
const FORWARD_INSTEAD =
  "You can forward the invitation instead. The people you send it to can add the event to their calendar but won't be on the guest list.";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invite.mockResolvedValue('sent');
  mocks.forward.mockResolvedValue({
    messageId: 'message-1',
    threadId: 'thread-1',
  });
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('adding guests from event details', () => {
  it('lists the current guests as fixed and invites an optional guest to the whole series by default', async () => {
    const user = userEvent.setup();
    renderGuests(event({ recurrenceLines: ['RRULE:FREQ=WEEKLY'] }));

    await user.click(screen.getByRole('button', { name: 'Add guests' }));
    const invited = screen.getByRole('list', { name: 'Invited guests' });
    expect(invited.textContent).toContain('host@example.com');
    expect(invited.textContent).toContain('me@example.com');
    expect(screen.queryByRole('button', { name: /Remove host/ })).toBeNull();

    await user.click(
      screen.getByRole('button', { name: 'Suggest Ada Lovelace' })
    );
    expect(
      screen.queryByRole('button', { name: 'Suggest Ada Lovelace' })
    ).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Optional' }));
    await user.click(screen.getByRole('button', { name: 'Send invitations' }));

    expect(mocks.invite).toHaveBeenCalledWith({
      eventId: 'event-1',
      calendarId: 'calendar-1',
      guests: [{ email: 'ada@example.com', optional: true }],
      scope: 'all',
      recurrenceId: undefined,
      occurrenceKey: undefined,
    });
    expect(
      screen
        .getByRole('button', { name: 'Add guests' })
        .getAttribute('aria-expanded')
    ).toBe('false');
    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith(
        'Invitation sent to Ada Lovelace'
      )
    );
  });

  it('sends to this occurrence with Cmd+Enter and drops a guest removed before sending', async () => {
    const user = userEvent.setup();
    renderGuests(
      event({
        recurrenceLines: ['RRULE:FREQ=WEEKLY'],
        recurrenceId: '2026-10-22T14:00:00Z',
      })
    );

    await user.click(screen.getByRole('button', { name: 'Add guests' }));
    await user.click(
      screen.getByRole('button', { name: 'Suggest Ada Lovelace' })
    );
    await user.click(
      screen.getByRole('button', { name: 'Suggest Grace Hopper' })
    );
    await user.click(
      screen.getByRole('button', { name: 'Remove Ada Lovelace' })
    );
    await user.click(
      screen.getByRole('button', { name: 'Suggest Ada Lovelace' })
    );
    await user.click(screen.getByRole('radio', { name: 'This event' }));
    screen.getByRole('textbox', { name: 'Search for guests' }).focus();
    await user.keyboard('{Meta>}{Enter}{/Meta}');

    expect(mocks.invite).toHaveBeenCalledWith({
      eventId: 'event-1',
      calendarId: 'calendar-1',
      guests: [
        { email: 'grace@example.com', optional: false },
        { email: 'ada@example.com', optional: false },
      ],
      scope: 'this_event',
      recurrenceId: '2026-10-22T14:00:00Z',
      occurrenceKey: '2026-10-22T14:00:00Z',
    });
    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith('Invitations sent to 2 people')
    );
  });

  it('offers no scope for a single event and closes on Escape without sending', async () => {
    const user = userEvent.setup();
    renderGuests(event());

    await user.click(screen.getByRole('button', { name: 'Add guests' }));
    expect(screen.queryByRole('radio', { name: 'All events' })).toBeNull();
    await user.click(
      screen.getByRole('button', { name: 'Suggest Ada Lovelace' })
    );
    screen.getByRole('textbox', { name: 'Search for guests' }).focus();
    await user.keyboard('{Escape}');

    expect(
      screen
        .getByRole('button', { name: 'Add guests' })
        .getAttribute('aria-expanded')
    ).toBe('false');
    expect(mocks.invite).not.toHaveBeenCalled();
  });

  it('does not call a queued invitation sent', async () => {
    mocks.invite.mockResolvedValue('queued');
    const user = userEvent.setup();
    renderGuests(event());

    await user.click(screen.getByRole('button', { name: 'Add guests' }));
    await user.click(
      screen.getByRole('button', { name: 'Suggest Ada Lovelace' })
    );
    await user.click(screen.getByRole('button', { name: 'Send invitations' }));

    await waitFor(() =>
      expect(mocks.alert).toHaveBeenCalledWith(
        'Invitations will be sent when you are back online'
      )
    );
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('explains and offers to forward instead when the organizer does not let guests invite', () => {
    renderGuests(event({ viewerCan: { ...MAY_INVITE, inviteGuests: false } }));

    expect(screen.queryByRole('button', { name: 'Add guests' })).toBeNull();
    expect(screen.getByText(`${RESTRICTED} ${FORWARD_INSTEAD}`)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Forward invitation' })
    ).toBeTruthy();
  });

  it('switches to the explanation once the organizer turns inviting off', () => {
    const [current, setCurrent] = createSignal(event());
    render(() => {
      const invites = createGuestInviteController(
        current,
        () => true,
        () => true
      );
      return (
        <EventGuests
          event={current()}
          invites={invites}
          closeDetails={vi.fn()}
        />
      );
    });
    expect(screen.getByRole('button', { name: 'Add guests' })).toBeTruthy();

    // The refetched event after the organizer's save echoes the new policy,
    // and the server resolves the guest's capabilities from it.
    setCurrent(
      event({
        guestPolicy: {
          canModify: false,
          canInviteOthers: false,
          canSeeOtherGuests: true,
        },
        viewerCan: { ...MAY_INVITE, inviteGuests: false },
      })
    );

    expect(screen.queryByRole('button', { name: 'Add guests' })).toBeNull();
    expect(screen.getByText(`${RESTRICTED} ${FORWARD_INSTEAD}`)).toBeTruthy();
  });

  it('switches to the explanation when the organizer refuses the invitation', async () => {
    mocks.invite.mockRejectedValue({ code: 'guests_cannot_invite' });
    const user = userEvent.setup();
    renderGuests(event());

    await user.click(screen.getByRole('button', { name: 'Add guests' }));
    await user.click(
      screen.getByRole('button', { name: 'Suggest Ada Lovelace' })
    );
    await user.click(screen.getByRole('button', { name: 'Send invitations' }));

    await waitFor(() => expect(mocks.failure).toHaveBeenCalledWith(RESTRICTED));
    expect(screen.queryByRole('button', { name: 'Add guests' })).toBeNull();
    expect(screen.getByText(`${RESTRICTED} ${FORWARD_INSTEAD}`)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Forward invitation' })
    ).toBeTruthy();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('says the organizer hid the guest list instead of counting the guests the viewer can see', () => {
    renderGuests(
      event({
        guestPolicy: {
          canModify: false,
          canInviteOthers: true,
          canSeeOtherGuests: false,
        },
        viewerCan: { ...MAY_INVITE, inviteGuests: false },
        attendees: [attendee({ email: 'me@example.com', isSelf: true })],
      })
    );

    expect(screen.getByText('Guest list hidden')).toBeTruthy();
    expect(screen.queryByText('1 attendee')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add guests' })).toBeNull();
    expect(screen.getByText(`${HIDDEN} ${FORWARD_INSTEAD}`)).toBeTruthy();
    expect(screen.queryByText(RESTRICTED, { exact: false })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Forward invitation' })
    ).toBeTruthy();
  });

  it('offers no guest addresses to copy while the organizer hides the guest list', () => {
    renderGuests(
      event({
        guestPolicy: {
          canModify: false,
          canInviteOthers: true,
          canSeeOtherGuests: false,
        },
        viewerCan: { ...MAY_INVITE, inviteGuests: false },
      })
    );

    expect(
      screen.queryByRole('button', { name: 'Copy guest emails' })
    ).toBeNull();
    // The organizer the copy lists can still be written to.
    expect(screen.getByRole('button', { name: 'Email guests' })).toBeTruthy();
  });

  it('switches to the hidden-list explanation when the server finds the list hidden', async () => {
    mocks.invite.mockRejectedValue({ code: 'guest_list_hidden' });
    const user = userEvent.setup();
    renderGuests(event());

    await user.click(screen.getByRole('button', { name: 'Add guests' }));
    await user.click(
      screen.getByRole('button', { name: 'Suggest Ada Lovelace' })
    );
    await user.click(screen.getByRole('button', { name: 'Send invitations' }));

    await waitFor(() => expect(mocks.failure).toHaveBeenCalledWith(HIDDEN));
    expect(screen.queryByRole('button', { name: 'Add guests' })).toBeNull();
    expect(screen.getByText(`${HIDDEN} ${FORWARD_INSTEAD}`)).toBeTruthy();
  });

  it('offers no guest addresses to copy or email when the viewer is the only guest', () => {
    renderGuests(
      event({
        isSnapshot: true,
        viewerCan: { ...MAY_INVITE, inviteGuests: false, rsvp: false },
        attendees: [attendee({ email: 'me@example.com', isSelf: true })],
      })
    );

    expect(
      screen.queryByRole('button', { name: 'Copy guest emails' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Email guests' })).toBeNull();
  });

  it('keeps today’s guest actions while guest invites are off', () => {
    renderGuests(event(), false, false);

    expect(
      screen.getByRole('button', { name: 'Copy guest emails' })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add guests' })).toBeNull();
    expect(screen.queryByText(RESTRICTED, { exact: false })).toBeNull();
  });
});

const CANNOT_INVITE = { ...MAY_INVITE, inviteGuests: false };

describe('forwarding the invitation from event details', () => {
  it('sends the picked people the event from the viewer’s copy, as Add guests picks them', async () => {
    const user = userEvent.setup();
    renderGuests(
      event({
        viewerCan: CANNOT_INVITE,
        recurrenceLines: ['RRULE:FREQ=WEEKLY'],
      })
    );

    await user.click(
      screen.getByRole('button', { name: 'Forward invitation' })
    );
    const invited = screen.getByRole('list', { name: 'Invited guests' });
    expect(invited.textContent).toContain('host@example.com');
    // A forward sends the series file, so there is no occurrence to pick.
    expect(screen.queryByRole('radio', { name: 'This event' })).toBeNull();
    expect(
      screen.getByText(
        "They can add the event to their calendar but won't appear in the guest list."
      )
    ).toBeTruthy();
    await user.click(
      screen.getByRole('button', { name: 'Suggest Ada Lovelace' })
    );
    expect(
      screen.getByRole('list', { name: 'Forward to' }).textContent
    ).toContain('Ada Lovelace');
    await user.click(screen.getByRole('button', { name: 'Forward' }));

    expect(mocks.forward).toHaveBeenCalledTimes(1);
    const [args] = mocks.forward.mock.calls[0];
    expect(args.eventId).toBe('event-1');
    expect(args.recipients).toEqual([
      { email: 'ada@example.com', name: 'Ada Lovelace' },
    ]);
    expect(args.bodyText).toMatch(/^Planning\n/);
    expect(
      args.bodyText.endsWith(
        "\n\nThis invitation was forwarded to you. Add the event to your calendar from the attached file. You won't be on the organizer's guest list."
      )
    ).toBe(true);
    expect(
      screen
        .getByRole('button', { name: 'Forward invitation' })
        .getAttribute('aria-expanded')
    ).toBe('false');
    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith(
        'Invitation forwarded to Ada Lovelace'
      )
    );
    expect(mocks.invite).not.toHaveBeenCalled();
  });

  it('sends with Cmd+Enter and names how many people it reached', async () => {
    const user = userEvent.setup();
    renderGuests(event({ viewerCan: CANNOT_INVITE }));

    await user.click(
      screen.getByRole('button', { name: 'Forward invitation' })
    );
    await user.click(
      screen.getByRole('button', { name: 'Suggest Ada Lovelace' })
    );
    await user.click(
      screen.getByRole('button', { name: 'Suggest Grace Hopper' })
    );
    screen.getByRole('textbox', { name: 'Search for guests' }).focus();
    await user.keyboard('{Meta>}{Enter}{/Meta}');

    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith(
        'Invitation forwarded to 2 people'
      )
    );
  });

  it('offers Retry when the email could not be sent, and Retry sends it again', async () => {
    mocks.forward.mockRejectedValueOnce({ code: 'send_failed' });
    const user = userEvent.setup();
    renderGuests(event({ viewerCan: CANNOT_INVITE }));

    await user.click(
      screen.getByRole('button', { name: 'Forward invitation' })
    );
    await user.click(
      screen.getByRole('button', { name: 'Suggest Ada Lovelace' })
    );
    await user.click(screen.getByRole('button', { name: 'Forward' }));

    await waitFor(() => expect(mocks.failure).toHaveBeenCalledTimes(1));
    const [message, options] = mocks.failure.mock.calls[0];
    expect(message).toBe('Could not forward the invitation');
    expect(
      options.actions.map((action: { label: string }) => action.label)
    ).toEqual(['Retry']);
    options.actions[0].onClick();
    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith(
        'Invitation forwarded to Ada Lovelace'
      )
    );
    expect(mocks.forward).toHaveBeenCalledTimes(2);
    expect(mocks.forward.mock.calls[1][0]).toEqual(
      mocks.forward.mock.calls[0][0]
    );
  });

  it('shows why the recipients were refused, without a retry that cannot help', async () => {
    mocks.forward.mockRejectedValueOnce({ code: 'invalid_recipients' });
    const user = userEvent.setup();
    renderGuests(event({ viewerCan: CANNOT_INVITE }));

    await user.click(
      screen.getByRole('button', { name: 'Forward invitation' })
    );
    await user.click(
      screen.getByRole('button', { name: 'Suggest Ada Lovelace' })
    );
    await user.click(screen.getByRole('button', { name: 'Forward' }));

    await waitFor(() => expect(mocks.failure).toHaveBeenCalledTimes(1));
    const [message, options] = mocks.failure.mock.calls[0];
    expect(message).toBe('Could not forward the invitation');
    expect(options.actions).toBeUndefined();
  });

  it('offers nothing on a snapshot, a cancelled event, or while forwarding is off', () => {
    renderGuests(
      event({
        isSnapshot: true,
        viewerCan: { ...CANNOT_INVITE, rsvp: false },
      })
    );
    expect(
      screen.queryByRole('button', { name: 'Forward invitation' })
    ).toBeNull();
    cleanup();

    renderGuests(event({ viewerCan: CANNOT_INVITE, isCancelled: true }));
    expect(
      screen.queryByRole('button', { name: 'Forward invitation' })
    ).toBeNull();
    cleanup();

    renderGuests(event({ viewerCan: CANNOT_INVITE }), true, false);
    expect(
      screen.queryByRole('button', { name: 'Forward invitation' })
    ).toBeNull();
    expect(screen.getByText(RESTRICTED)).toBeTruthy();
  });

  it('forwards whether or not guest invites are on, since it adds no guests', () => {
    renderGuests(event({ viewerCan: CANNOT_INVITE }), false, true);
    expect(
      screen.getByRole('button', { name: 'Forward invitation' })
    ).toBeTruthy();
    expect(screen.getByText(`${RESTRICTED} ${FORWARD_INSTEAD}`)).toBeTruthy();
  });

  it('offers nothing on a team projection or a read-only copy', () => {
    renderGuests(
      event({
        viewerCan: CANNOT_INVITE,
        teamProjection: {
          ownerId: 'macro|teammate@example.com',
          kind: 'details',
        },
      })
    );
    expect(
      screen.queryByRole('button', { name: 'Forward invitation' })
    ).toBeNull();
    cleanup();

    renderGuests(event({ viewerCan: CANNOT_INVITE, isReadOnly: true }));
    expect(
      screen.queryByRole('button', { name: 'Forward invitation' })
    ).toBeNull();
  });
});

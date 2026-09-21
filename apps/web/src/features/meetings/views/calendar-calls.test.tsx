// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CalendarCallsActions,
  CalendarCallsSource,
} from '../context/calendar-calls';
import type { CalendarCallItem } from '../core/calendar-calls';
import { CalendarCalls } from './calendar-calls';

const item: CalendarCallItem = {
  id: 'meeting:one',
  title: 'Planning call',
  group: 'instant',
  link: {
    id: 'one',
    title: 'Planning call',
    url: 'https://macro.com/app/meet/example-token-long',
  },
};

function setup(initial: CalendarCallItem[] = [item]) {
  const [items, setItems] = createSignal(initial);
  const source: CalendarCallsSource = {
    items,
    loading: () => false,
    refreshing: () => false,
    error: () => undefined,
    hasMore: () => false,
    refresh: vi.fn(),
    loadMore: vi.fn(),
  };
  const actions: CalendarCallsActions = {
    schedule: vi.fn(),
    join: vi.fn(async () => undefined),
    copy: vi.fn(async () => true),
    openRecord: vi.fn(),
    rename: vi.fn(async () => undefined),
    revoke: vi.fn(async () => {
      setItems([]);
    }),
    openEvent: vi.fn(),
    editEvent: vi.fn(),
  };
  render(() => <CalendarCalls source={source} actions={actions} />);
  return { source, actions, setItems };
}
beforeEach(() => vi.spyOn(window, 'scrollTo').mockImplementation(() => {}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Calendar Calls dashboard', () => {
  it.each(['past', 'future', 'current'] as const)(
    'shows Join in the row and details only for a current scheduled call (%s)',
    (when) => {
      const now = Date.now();
      const start =
        now +
        (when === 'future' ? 60_000 : when === 'past' ? -120_000 : -60_000);
      const scheduled = {
        ...item,
        group: when === 'past' ? ('recent' as const) : ('scheduled' as const),
        start: new Date(start).toISOString(),
        end: new Date(start + 90_000).toISOString(),
      };
      setup([scheduled]);
      if (when !== 'past')
        fireEvent.click(screen.getByRole('button', { name: /Upcoming/ }));
      expect(Boolean(screen.queryByRole('button', { name: 'Join' }))).toBe(
        when === 'current'
      );
      fireEvent.click(screen.getByRole('button', { name: 'Planning call' }));
      expect(Boolean(screen.queryByRole('button', { name: 'Join call' }))).toBe(
        when === 'current'
      );
      expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
    }
  );
  it('opens actionable call details on hover without a dialog', async () => {
    const { actions } = setup([{ ...item, group: 'recent' }]);
    fireEvent.pointerEnter(screen.getByLabelText('Preview Planning call'), {
      pointerType: 'mouse',
    });
    await vi.waitFor(() =>
      expect(screen.getByRole('article', { name: 'Call details' })).toBeTruthy()
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Join call' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await vi.waitFor(() => expect(actions.copy).toHaveBeenCalled());
    expect(actions.join).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close call details' }));
    await vi.waitFor(() =>
      expect(screen.queryByRole('article', { name: 'Call details' })).toBeNull()
    );
  });
  it('defaults to Recent on the left and removes Open Calendar', () => {
    setup();
    const tabs = within(screen.getByLabelText('Call history')).getAllByRole(
      'button'
    );
    expect(tabs[0].textContent).toContain('Recent');
    expect(tabs[0].getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: /Open Calendar/i })).toBeNull();
  });
  it('exposes real join and link-copy actions while keeping standalone calls out of team memory', async () => {
    const { actions } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Upcoming/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Planning call' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start call' }));
    await vi.waitFor(() => expect(actions.join).toHaveBeenCalledWith(item));
    fireEvent.click(screen.getByRole('button', { name: 'Copy call link' }));
    await vi.waitFor(() =>
      expect(actions.copy).toHaveBeenCalledWith(item.link!.url)
    );
    expect(screen.getByText(/Outside team memory/)).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByText('Guests wait in the lobby')).toBeNull();
  });

  it('confirms revocation before changing a link and returns to the empty list', async () => {
    const { actions } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Upcoming/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Planning call' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke link' }));
    expect(actions.revoke).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Current participants stay connected/)
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke link' }));
    await vi.waitFor(() => expect(actions.revoke).toHaveBeenCalledWith('one'));
    expect(screen.getByRole('button', { name: 'Create event' })).toBeTruthy();
  });

  it('can copy a live channel link without exposing owner link-management controls', async () => {
    const live: CalendarCallItem = {
      id: 'live:channel',
      title: 'Team standup',
      group: 'live',
      record: {
        id: 'call-live',
        title: 'Team standup',
        active: true,
        channelId: 'channel-1',
        startedAt: '2026-09-18T12:00:00Z',
        people: [],
      },
    };
    const { actions } = setup([live]);
    actions.resolveLink = vi.fn(
      async () => 'https://macro.com/app/meet/returned-channel-link'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Team standup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await vi.waitFor(() =>
      expect(actions.copy).toHaveBeenCalledWith(
        'https://macro.com/app/meet/returned-channel-link'
      )
    );
    expect(
      (screen.getByRole('textbox', { name: 'Call link' }) as HTMLInputElement)
        .value
    ).toBe('https://macro.com/app/meet/returned-channel-link');
    expect(screen.queryByRole('button', { name: /Revoke/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
  });

  it('opens the matched event and hides editing for read-only invitations', () => {
    const event = {
      eventId: 'event-1',
      occurrenceKey: 'instance-1',
      title: 'Invited meeting',
      start: '2026-09-20T12:00:00Z',
      end: '2026-09-20T12:30:00Z',
      url: item.link!.url,
      attendees: [
        { name: 'Taylor', email: 'taylor@example.com', status: 'accepted' },
      ],
      canEdit: false,
    };
    const { actions } = setup([
      { id: 'event:one', title: event.title, group: 'scheduled', event },
    ]);
    fireEvent.click(screen.getByRole('button', { name: /Upcoming/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Invited meeting' }));
    expect(screen.queryByRole('button', { name: 'Edit event' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Revoke/ })).toBeNull();
    expect(
      within(screen.getByRole('region', { name: 'People' })).getByText('Going')
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open event' }));
    expect(actions.openEvent).toHaveBeenCalledWith(event);
    // Kobalte retains the closing portal until its browser transition finishes.
    expect(screen.getByRole('dialog').hasAttribute('data-closed')).toBe(true);
  });

  it('keeps recording access and channel privacy for a selected historical call', () => {
    const recorded: CalendarCallItem = {
      id: 'record:one',
      title: 'Channel review',
      group: 'recent',
      record: {
        id: 'call-1',
        title: 'Channel review',
        channelId: 'channel-1',
        active: false,
        startedAt: '2026-09-17T12:00:00Z',
        people: ['Taylor'],
        summary: 'Decisions from the review.',
      },
    };
    const { actions } = setup([item, recorded]);
    fireEvent.click(screen.getByRole('button', { name: /Recent/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Channel review' }));
    expect(screen.getByText('Decisions from the review.')).toBeTruthy();
    expect(screen.queryByText('Excluded from team memory')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Join call' })).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Open recording & transcript' })
    );
    expect(actions.openRecord).toHaveBeenCalledWith('call-1');
    expect(screen.getByRole('dialog').hasAttribute('data-closed')).toBe(true);
  });

  it('keeps reusable links separate from upcoming events and exposes inline actions', async () => {
    const { actions } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Upcoming/ }));
    const links = screen.getByRole('region', { name: 'Your links' });
    expect(within(links).getByText('Any time')).toBeTruthy();
    fireEvent.click(within(links).getByRole('button', { name: 'Start' }));
    await vi.waitFor(() => expect(actions.join).toHaveBeenCalledWith(item));
    fireEvent.click(
      within(links).getByRole('button', { name: 'Copy link for Planning call' })
    );
    await vi.waitFor(() =>
      expect(actions.copy).toHaveBeenCalledWith(item.link!.url)
    );
    fireEvent.click(screen.getByRole('button', { name: /Recent/ }));
    expect(screen.queryByRole('region', { name: 'Your links' })).toBeNull();
    expect(screen.getByText('No recent calls.')).toBeTruthy();
  });
});

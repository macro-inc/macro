import { fireEvent, render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requestToJoin: vi.fn(),
  calendars: [] as {
    id: string;
    name: string;
    emailAddress: string;
    isWritable: boolean;
  }[],
}));
vi.mock('@queries/calendar/calendars', () => ({
  useVisibleCalendarsQuery: () => ({ isSuccess: true, data: mocks.calendars }),
}));
vi.mock('@queries/calendar/mutations', () => ({
  useCopySharedCalendarEventMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useDownloadCalendarEventIcsMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));
vi.mock('@queries/calendar/join-requests', () => ({
  useRequestToJoinCalendarEventMutation: (callbacks: {
    onSuccess: () => void;
  }) => ({
    mutate: (eventId: string) => {
      mocks.requestToJoin(eventId);
      callbacks.onSuccess();
    },
    isPending: false,
  }),
}));

import { SharedEventActions } from './SharedEventActions';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calendars = [
    {
      id: 'cal-1',
      name: 'me@example.com',
      emailAddress: 'me@example.com',
      isWritable: true,
    },
  ];
});

describe('shared event actions', () => {
  it('asks to join when the owner can add guests', () => {
    render(() => (
      <SharedEventActions
        eventId="shared-event"
        title="Offsite"
        canRequestToJoin
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    expect(mocks.requestToJoin).toHaveBeenCalledWith('shared-event');
    expect(screen.getByText('Requested')).toBeTruthy();
  });

  it('shows a sent request instead of the button', () => {
    render(() => (
      <SharedEventActions
        eventId="shared-event"
        title="Offsite"
        canRequestToJoin
        joinRequestStatus="pending"
      />
    ));

    expect(screen.getByText('Requested')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ask to join' })).toBeNull();
  });

  it('offers asking again after a decline', () => {
    render(() => (
      <SharedEventActions
        eventId="shared-event"
        title="Offsite"
        canRequestToJoin
        joinRequestStatus="declined"
      />
    ));

    expect(screen.getByRole('button', { name: 'Ask to join' })).toBeTruthy();
  });

  it('hides asking when only the organizer could add the viewer', () => {
    render(() => (
      <SharedEventActions
        eventId="shared-event"
        title="Offsite"
        canRequestToJoin={false}
      />
    ));

    expect(screen.queryByRole('button', { name: 'Ask to join' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Add to calendar' })
    ).toBeTruthy();
  });
});

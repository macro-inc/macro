import { fireEvent, render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  respond: vi.fn(),
  enabled: undefined as boolean | undefined,
  requests: [] as unknown[],
}));
vi.mock('@queries/calendar/join-requests', () => ({
  useCalendarJoinRequestsQuery: (
    _eventId: () => string,
    options: () => { enabled?: boolean }
  ) => {
    mocks.enabled = options().enabled;
    return { isSuccess: true, data: mocks.requests };
  },
  useRespondToCalendarJoinRequestMutation: () => ({
    mutate: mocks.respond,
    isPending: false,
  }),
}));

import { EventJoinRequests } from './EventJoinRequests';

const request = {
  id: 'request-1',
  eventId: 'event-1',
  requesterId: 'macro|asker@example.com',
  requesterEmail: 'asker@example.com',
  status: 'pending',
  createdAt: '2026-09-24T12:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requests = [request];
});

describe('event join requests', () => {
  it('lets an editor add or decline each requester', () => {
    render(() => <EventJoinRequests eventId="event-1" canModify />);

    expect(screen.getByText('Someone asked to join')).toBeTruthy();
    expect(screen.getByText('asker@example.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add as guest' }));
    expect(mocks.respond).toHaveBeenCalledWith({ request, decision: 'accept' });
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(mocks.respond).toHaveBeenCalledWith({
      request,
      decision: 'decline',
    });
  });

  it('neither fetches nor shows requests on an event the viewer cannot edit', () => {
    render(() => <EventJoinRequests eventId="event-1" canModify={false} />);

    expect(mocks.enabled).toBe(false);
    expect(screen.queryByText(/asked to join/)).toBeNull();
  });

  it('shows nothing without pending requests', () => {
    mocks.requests = [];
    render(() => <EventJoinRequests eventId="event-1" canModify />);

    expect(screen.queryByText(/asked to join/)).toBeNull();
  });
});

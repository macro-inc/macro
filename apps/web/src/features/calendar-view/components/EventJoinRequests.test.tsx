/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventJoinRequests } from './EventJoinRequests';

const request = {
  id: 'request-1',
  eventId: 'shared-event',
  requesterId: 'macro|member@example.com',
  requesterEmail: 'member@work.example.com',
  status: 'pending' as const,
  createdAt: '2026-10-22T18:00:00Z',
};

const mocks = vi.hoisted(() => ({
  requests: [] as (typeof request)[],
  listEnabled: vi.fn(),
  respond: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: mocks.success, failure: mocks.failure },
}));
vi.mock('@entity/owner/owner-display', () => ({
  OwnerLabel: (props: { ownerId: string }) => <span>{props.ownerId}</span>,
}));
vi.mock('@queries/calendar/mutations', () => ({
  isGuestInviteRefused: (error: unknown) =>
    (error as { code?: string }).code === 'guests_cannot_invite',
}));
// The answer's transport and invalidation are the query module's; here it
// resolves with whatever `mocks.respond` returns or throws.
vi.mock('@queries/calendar/join-requests', () => ({
  useCalendarJoinRequestsQuery: (
    _eventId: () => string,
    options: () => { enabled: boolean }
  ) => {
    mocks.listEnabled(options().enabled);
    return { isPending: false, data: mocks.requests };
  },
  useRespondToCalendarJoinRequestMutation: (callbacks?: {
    onSuccess?: (answered: typeof request) => void;
    onError?: (error: unknown) => void;
  }) => ({
    isPending: false,
    mutate: (args: { request: typeof request; decision: string }) => {
      try {
        callbacks?.onSuccess?.(mocks.respond(args));
      } catch (error) {
        callbacks?.onError?.(error);
      }
    },
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.requests = [];
});

describe('event join requests', () => {
  it('adds a requester as a guest', () => {
    mocks.requests = [request];
    mocks.respond.mockReturnValue({ ...request, status: 'accepted' });
    render(() => <EventJoinRequests eventId="shared-event" canModify />);

    expect(screen.getByText('Someone asked to join')).toBeTruthy();
    expect(screen.getByText('member@work.example.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add as guest' }));

    expect(mocks.respond).toHaveBeenCalledWith({
      request,
      decision: 'accept',
    });
    expect(mocks.success).toHaveBeenCalledWith(
      'Invited member@work.example.com'
    );
  });

  it('declines a request', () => {
    mocks.requests = [request];
    mocks.respond.mockReturnValue({ ...request, status: 'declined' });
    render(() => <EventJoinRequests eventId="shared-event" canModify />);

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));

    expect(mocks.respond).toHaveBeenCalledWith({
      request,
      decision: 'decline',
    });
  });

  it('explains when the organizer refuses the new guest', () => {
    mocks.requests = [request];
    mocks.respond.mockImplementation(() => {
      throw { code: 'guests_cannot_invite' };
    });
    render(() => <EventJoinRequests eventId="shared-event" canModify />);

    fireEvent.click(screen.getByRole('button', { name: 'Add as guest' }));

    expect(mocks.failure).toHaveBeenCalledWith(
      "The organizer doesn't let guests invite others"
    );
  });

  it('neither fetches nor shows requests for someone who cannot change the event', () => {
    mocks.requests = [request];
    render(() => (
      <EventJoinRequests eventId="shared-event" canModify={false} />
    ));

    expect(mocks.listEnabled).toHaveBeenCalledWith(false);
    expect(
      screen.queryByRole('region', { name: 'Requests to join' })
    ).toBeNull();
  });
});

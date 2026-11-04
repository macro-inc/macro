/**
 * @vitest-environment jsdom
 */

import { handleRefreshCalendar } from '@queries/calendar/sync';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventJoinRequests } from './EventJoinRequests';

const request = {
  id: 'request-1',
  eventId: 'shared-event',
  requesterId: 'macro|member@example.com',
  requesterEmail: 'member@work.example.com',
  status: 'pending' as const,
  createdAt: '2026-10-22T18:00:00Z',
};

const otherRequest = {
  ...request,
  id: 'request-2',
  requesterId: 'macro|other@example.com',
  requesterEmail: 'other@work.example.com',
};

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  answer: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
  alert: vi.fn(),
}));

let testQueryClient: QueryClient;
/** What the server holds as pending; answering in a test edits it. */
let pending: (typeof request)[];

vi.mock('@queries/client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: mocks.success, failure: mocks.failure, alert: mocks.alert },
}));
vi.mock('@entity/owner/owner-display', () => ({
  OwnerLabel: (props: { ownerId: string }) => <span>{props.ownerId}</span>,
}));
vi.mock('@queries/calendar/mutations', async () => {
  const { thrownResultErrorHasCode } = await import('@core/util/result');
  return {
    isGuestInviteRefused: (error: unknown) =>
      thrownResultErrorHasCode(error, 'guests_cannot_invite'),
  };
});
vi.mock('@queries/calendar/occurrences', () => ({
  invalidateCalendarOccurrences: vi.fn(),
}));
vi.mock('@queries/calendar/invitations', () => ({
  invalidateCalendarInvitations: vi.fn(),
}));
vi.mock('@queries/calendar/team-cache', () => ({
  refreshTeamCalendarQueries: vi.fn(),
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { listCalendarEventJoinRequests: mocks.list },
}));
vi.mock('@service-email/client', () => ({
  emailClient: { respondToCalendarJoinRequest: mocks.answer },
}));

function renderRequests(canModify = true) {
  return render(() => (
    <QueryClientProvider client={testQueryClient}>
      <EventJoinRequests eventId="shared-event" canModify={canModify} />
    </QueryClientProvider>
  ));
}

const SYNCED = {
  event: 'synced',
  link_id: '019fdd65-dcc1-74fb-a9c6-8162c11c5854',
};

beforeEach(() => {
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  pending = [request];
  // Fresh objects, like every parsed response.
  mocks.list.mockImplementation(async () =>
    ok({ requests: pending.map((row) => ({ ...row })) })
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  testQueryClient.clear();
});

describe('event join requests', () => {
  it('adds a requester as a guest', async () => {
    mocks.answer.mockImplementation(async () => {
      pending = [];
      return ok({ ...request, status: 'accepted' });
    });
    renderRequests();

    expect(await screen.findByText('Someone asked to join')).toBeTruthy();
    expect(screen.getByText('member@work.example.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add as guest' }));

    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith(
        'Invited member@work.example.com'
      )
    );
    expect(mocks.answer).toHaveBeenCalledWith('request-1', {
      decision: 'accept',
    });
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: 'Requests to join' })
      ).toBeNull()
    );
  });

  it('declines a request', async () => {
    mocks.answer.mockImplementation(async () => {
      pending = [];
      return ok({ ...request, status: 'declined' });
    });
    renderRequests();

    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));

    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith('Declined the request')
    );
    expect(mocks.answer).toHaveBeenCalledWith('request-1', {
      decision: 'decline',
    });
  });

  // The list is open, so the row is still there when someone else's answer
  // gets in first. The server returns the request as that answer left it.
  it.each([
    {
      press: 'Decline',
      status: 'accepted',
      toast: 'Already answered: member@work.example.com was invited',
    },
    {
      press: 'Add as guest',
      status: 'declined',
      toast: 'Already answered: this request was declined',
    },
  ])(
    'says $press was too late when the request is already $status',
    async ({ press, status, toast }) => {
      mocks.answer.mockImplementation(async () => {
        pending = [];
        return ok({ ...request, status });
      });
      renderRequests();

      fireEvent.click(await screen.findByRole('button', { name: press }));

      await waitFor(() => expect(mocks.alert).toHaveBeenCalledWith(toast));
      expect(mocks.success).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(
          screen.queryByRole('region', { name: 'Requests to join' })
        ).toBeNull()
      );
    }
  );

  // An acceptance overrules a decline that lands while it writes the
  // invitation, so its own `accepted` is an invitation, not a late press.
  it('reports an acceptance that overruled a decline as the invitation it is', async () => {
    mocks.answer.mockResolvedValue(ok({ ...request, status: 'accepted' }));
    renderRequests();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Add as guest' })
    );

    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith(
        'Invited member@work.example.com'
      )
    );
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it('drops a request answered elsewhere from an open list', async () => {
    pending = [request, otherRequest];
    renderRequests();
    expect(await screen.findByText('2 people asked to join')).toBeTruthy();

    pending = [otherRequest];
    handleRefreshCalendar(SYNCED);

    expect(await screen.findByText('Someone asked to join')).toBeTruthy();
    expect(screen.queryByText('member@work.example.com')).toBeNull();
    expect(screen.getByText('other@work.example.com')).toBeTruthy();
    expect(mocks.answer).not.toHaveBeenCalled();
  });

  it('keeps focus on the remaining row when another request leaves', async () => {
    pending = [request, otherRequest];
    renderRequests();
    const [, otherDecline] = await screen.findAllByRole('button', {
      name: 'Decline',
    });
    otherDecline?.focus();

    pending = [otherRequest];
    handleRefreshCalendar(SYNCED);

    await screen.findByText('Someone asked to join');
    expect(document.activeElement).toBe(otherDecline);
  });

  it('explains when the organizer refuses the new guest', async () => {
    mocks.answer.mockResolvedValue(
      err([{ code: 'guests_cannot_invite', message: 'refused' }])
    );
    renderRequests();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Add as guest' })
    );

    await waitFor(() =>
      expect(mocks.failure).toHaveBeenCalledWith(
        "The organizer doesn't let guests invite others"
      )
    );
  });

  it('neither fetches nor shows requests for someone who cannot change the event', async () => {
    renderRequests(false);
    handleRefreshCalendar(SYNCED);
    await Promise.resolve();

    expect(mocks.list).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('region', { name: 'Requests to join' })
    ).toBeNull();
  });
});

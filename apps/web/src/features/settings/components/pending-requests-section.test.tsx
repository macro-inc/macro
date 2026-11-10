import { queryClient } from '@queries/client';
import type { Harness } from '@service-storage/client';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PendingRequestsSection } from './pending-requests-section';

const VIEWER = 'macro|owner@x.test';
const ALICE = 'macro|alice@x.test';
const MINE = '0198a4cc-e138-7670-a308-a6b766602701';
const ALICES = '0198a4cc-e138-7670-a308-a6b766602702';

type ServerRequest = {
  id: string;
  requesterId: string;
  requestedLevel: 'edit';
  status: 'pending' | 'granted' | 'denied' | 'cancelled';
  revision: number;
  createdAt: string;
  updatedAt: string;
};

/** A scripted storage service: one request on the viewer's machine, one by them. */
const server = vi.hoisted(() => ({
  incoming: [] as ServerRequest[],
  mine: null as ServerRequest | null,
  stateReads: 0,
}));

vi.mock('@service-storage/access-requests', () => ({
  accessRequestsClient: {
    state: async (entity: { entityId: string }) => {
      server.stateReads++;
      // A real read finishes on a later task, after the row has rendered.
      await new Promise((resolve) => setTimeout(resolve));
      if (entity.entityId === MINE) {
        const pending = server.incoming.filter(
          (request) => request.status === 'pending'
        );
        return ok({
          canReview: true,
          accessLevel: 'owner',
          supportedLevels: ['view', 'edit'],
          requests: pending,
          pendingCount: pending.length,
        });
      }
      return ok({
        canReview: false,
        accessLevel: null,
        supportedLevels: ['view', 'edit'],
        mine: server.mine,
        requests: [],
        pendingCount: 0,
      });
    },
    resolve: async (
      _entity: unknown,
      id: string,
      _revision: number,
      level: 'edit' | null
    ) => {
      const request = server.incoming.find((request) => request.id === id);
      if (request) request.status = level ? 'granted' : 'denied';
      return ok(request);
    },
    cancel: async () => {
      if (server.mine) server.mine = { ...server.mine, status: 'cancelled' };
      return ok(undefined);
    },
    grants: async () => ok([]),
    submit: async () => ok(server.mine),
    setGrant: async () => ok(undefined),
  },
}));

const machine = (
  id: string,
  name: string,
  owner: string,
  access: Harness['access']
): Harness => ({
  allow_permission_bypass: false,
  id,
  kind: 'macrod',
  name,
  owner: { type: 'user', user_id: owner },
  access,
  shared_team_ids: [],
  created_by: owner,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  connected: true,
  last_connected_at: null,
});

vi.mock('@queries/harnesses/harnesses', () => ({
  useHarnessesQuery: () => ({
    isSuccess: true,
    data: [machine(MINE, 'Mac mini', VIEWER, 'owner')],
  }),
  useHarnessDirectoryQuery: () => ({
    isSuccess: true,
    data: [
      machine(MINE, 'Mac mini', VIEWER, 'owner'),
      machine(ALICES, 'Build box', ALICE, 'none'),
    ],
  }),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => VIEWER }));
vi.mock('@core/auth', () => ({ useIsAuthenticated: () => () => true }));
vi.mock('@entity/owner/owner-display', () => ({
  OwnerLabel: (props: { ownerId: string }) => <span>{props.ownerId}</span>,
}));

const request = (id: string, requesterId: string): ServerRequest => ({
  id,
  requesterId,
  requestedLevel: 'edit',
  status: 'pending',
  revision: 1,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
});

const rows = (kind: 'incoming' | 'outgoing') =>
  document.querySelectorAll(`[data-pending-request="${kind}"]`).length;

function show() {
  render(() => (
    <QueryClientProvider client={queryClient}>
      <PendingRequestsSection />
    </QueryClientProvider>
  ));
}

beforeEach(() => {
  server.incoming = [request('r-alice', ALICE)];
  server.mine = request('r-mine', VIEWER);
  server.stateReads = 0;
});
afterEach(() => queryClient.clear());

describe('PendingRequestsSection', () => {
  it('lists requests on the viewer’s machines and their own', async () => {
    show();
    await waitFor(() => expect(rows('incoming')).toBe(1));
    await waitFor(() => expect(rows('outgoing')).toBe(1));
  });

  it('keeps its rows across refetches, so a click during one still lands', async () => {
    show();
    const approve = await screen.findByRole('button', { name: 'Approve' });
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    const settledReads = server.stateReads;

    await queryClient.refetchQueries();
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));

    expect(approve.isConnected).toBe(true);
    // One refetch reads each machine once, not once per remounted row.
    expect(server.stateReads - settledReads).toBe(2);
    fireEvent.click(approve);
    await waitFor(() => expect(server.incoming[0]?.status).toBe('granted'));
  });

  it('drops a request once it is approved', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(rows('incoming')).toBe(0));
    expect(server.incoming[0]?.status).toBe('granted');
  });

  it('drops a request once it is denied', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(rows('incoming')).toBe(0));
    expect(server.incoming[0]?.status).toBe('denied');
  });

  it('drops the viewer’s own request once they take it back', async () => {
    show();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Cancel request' })
    );
    await waitFor(() => expect(rows('outgoing')).toBe(0));
    expect(server.mine?.status).toBe('cancelled');
  });

  it('is hidden when nothing waits', async () => {
    server.incoming = [];
    server.mine = null;
    show();
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(
      document.querySelector('[data-pending-runtime-requests]')
    ).toBeNull();
  });
});

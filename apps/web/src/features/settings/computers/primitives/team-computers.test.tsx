/**
 * @vitest-environment jsdom
 */

import { render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { afterEach, expect, it, vi } from 'vitest';
import { useTeamComputers } from './team-computers';

const mocks = vi.hoisted(() => ({
  listComputers: vi.fn(),
  rollout: vi.fn(),
  getHarnesses: vi.fn(),
}));

vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({ isPending: false, data: { id: 'team-1' } }),
}));
vi.mock('@service-auth/computers', () => ({
  computersClient: { list: mocks.listComputers, rollout: mocks.rollout },
  COMPUTERS_UNAVAILABLE: 'COMPUTERS_UNAVAILABLE',
  BILLING_PROVIDER_FAILED: 'BILLING_PROVIDER_FAILED',
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { getHarnesses: mocks.getHarnesses },
}));

let unmount: (() => void) | undefined;

afterEach(() => {
  unmount?.();
  unmount = undefined;
});

it('shows and fetches no computers when the backend has not rolled them out', async () => {
  mocks.rollout.mockResolvedValue(ok({ enabled: false }));
  mocks.listComputers.mockResolvedValue(ok([]));
  mocks.getHarnesses.mockResolvedValue(ok([]));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let teamComputers: ReturnType<typeof useTeamComputers> | undefined;
  function Probe() {
    teamComputers = useTeamComputers();
    return null;
  }
  unmount = render(() => (
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>
  )).unmount;
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(teamComputers?.enabled()).toBe(false);
  expect(teamComputers?.canPurchase()).toBe(false);
  expect(teamComputers?.computers()).toEqual([]);
  expect(mocks.rollout).toHaveBeenCalled();
  expect(mocks.listComputers).not.toHaveBeenCalled();
});

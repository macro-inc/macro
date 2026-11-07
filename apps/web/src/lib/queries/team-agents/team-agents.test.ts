import type { TeamAgent } from '@service-auth/generated/schemas';
import { cleanup, renderHook, waitFor } from '@solidjs/testing-library';
import { focusManager, QueryObserver } from '@tanstack/query-core';
import { err, ok } from 'neverthrow';
import { createComponent } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@service-auth/client', () => ({
  authServiceClient: {
    getTeamAgentSizes: vi.fn(),
    quoteTeamAgent: vi.fn(),
    listTeamAgents: vi.fn(),
    getTeamAgentComputer: vi.fn(),
  },
}));

import { authServiceClient } from '@service-auth/client';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import {
  teamAgentComputerAvailabilityQueryOptions,
  teamAgentComputerQueryOptions,
  teamAgentQuoteQueryOptions,
  teamAgentSizesQueryOptions,
  teamAgentsQueryOptions,
  useTeamAgentComputerAvailability,
  useTeamAgentComputerMutation,
} from './index';

describe('team agents queries', () => {
  it('scopes quotes by team and size and reads the server total', async () => {
    const quote = {
      included: false,
      seat: 2000,
      computer: 3000,
      total: 5000,
      currency: 'usd',
      vcpus: 4,
      memoryGb: 16,
      diskGb: 100,
      interval: 'month' as const,
    };
    vi.mocked(authServiceClient.quoteTeamAgent).mockResolvedValue(ok(quote));
    const client = new QueryClient();
    try {
      expect(
        await client.fetchQuery(teamAgentQuoteQueryOptions('team-1', 'large'))
      ).toEqual(quote);
      expect(authServiceClient.quoteTeamAgent).toHaveBeenCalledWith('large');
      expect(
        teamAgentQuoteQueryOptions('team-1', 'large').queryKey
      ).not.toEqual(teamAgentQuoteQueryOptions('team-1', 'standard').queryKey);
      expect(teamAgentsQueryOptions('team-1').queryKey).not.toEqual(
        teamAgentsQueryOptions('team-2').queryKey
      );
    } finally {
      client.clear();
    }
  });
});

it('refreshes visible agent health after provisioning, recovers unhealthy agents, and stops on an empty roster', async () => {
  vi.useFakeTimers();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const agent: TeamAgent = {
    userId: 'agent-1',
    teamId: 'team-1',
    name: 'Assistant',
    email: 'agent@example.com',
    createdAt: '2026-01-01',
    status: 'provisioning',
    retryable: false,
    payment: 'paid',
  };
  vi.mocked(authServiceClient.listTeamAgents)
    .mockResolvedValueOnce(ok({ agents: [agent] }))
    .mockResolvedValueOnce(ok({ agents: [{ ...agent, status: 'running' }] }))
    .mockResolvedValueOnce(
      ok({
        agents: [
          {
            ...agent,
            status: 'unhealthy',
            statusReason: 'Brain unavailable',
            retryable: false,
          },
        ],
      })
    )
    .mockResolvedValueOnce(ok({ agents: [{ ...agent, status: 'running' }] }))
    .mockResolvedValue(ok({ agents: [] }));
  const options = teamAgentsQueryOptions('team-1');
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  try {
    await client.fetchQuery(options);
    expect(authServiceClient.listTeamAgents).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(observer.getCurrentResult().data?.agents[0].status).toBe('running');
    expect(authServiceClient.listTeamAgents).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(29000);
    expect(authServiceClient.listTeamAgents).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(observer.getCurrentResult().data?.agents[0].status).toBe(
      'unhealthy'
    );
    expect(observer.getCurrentResult().data?.agents[0].retryable).toBe(false);
    expect(authServiceClient.listTeamAgents).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(30000);
    expect(observer.getCurrentResult().data?.agents[0].status).toBe('running');
    expect(authServiceClient.listTeamAgents).toHaveBeenCalledTimes(4);
    focusManager.setFocused(false);
    await vi.advanceTimersByTimeAsync(60000);
    expect(authServiceClient.listTeamAgents).toHaveBeenCalledTimes(4);
    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(30000);
    expect(observer.getCurrentResult().data?.agents).toEqual([]);
    expect(authServiceClient.listTeamAgents).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(60000);
    expect(authServiceClient.listTeamAgents).toHaveBeenCalledTimes(5);
    unsubscribe();
    await vi.advanceTimersByTimeAsync(60000);
    expect(authServiceClient.listTeamAgents).toHaveBeenCalledTimes(5);
  } finally {
    unsubscribe();
    client.clear();
    focusManager.setFocused(undefined);
    vi.useRealTimers();
  }
});

it('loads the independent catalog even when quoting rejects an inactive subscription', async () => {
  const { err } = await import('neverthrow');
  const { thrownResultErrorHasCode } = await import('@core/util/result');
  const catalog = {
    sizes: [{ size: 'standard' as const, vcpus: 4, memoryGb: 8, diskGb: 100 }],
  };
  vi.mocked(authServiceClient.getTeamAgentSizes).mockResolvedValue(ok(catalog));
  vi.mocked(authServiceClient.quoteTeamAgent).mockResolvedValue(
    err([{ code: 'no_subscription', message: 'Active plan required' }])
  );
  const client = new QueryClient();
  try {
    expect(
      await client.fetchQuery(teamAgentSizesQueryOptions('team-free'))
    ).toEqual(catalog);
    try {
      await client.fetchQuery(
        teamAgentQuoteQueryOptions('team-free', 'standard')
      );
      throw new Error('quote should fail');
    } catch (error) {
      expect(thrownResultErrorHasCode(error, 'no_subscription')).toBe(true);
    }
  } finally {
    client.clear();
  }
});

it('caches discovery 503 as absence, avoids roster prefetch and recovers after reattachment', async () => {
  const { queryClient } = await import('../client');
  const { teamAgentKeys } = await import('./keys');
  vi.useFakeTimers();
  vi.mocked(authServiceClient.getTeamAgentComputer).mockReset();
  queryClient.clear();
  const computer = {
    computerId: 'computer',
    harnessId: 'runtime',
    isAgentComputer: true,
  };
  vi.mocked(authServiceClient.getTeamAgentComputer)
    .mockResolvedValueOnce(
      err([{ code: 'COMPUTERS_UNAVAILABLE', message: 'No fleet' }])
    )
    .mockResolvedValue(ok(computer));
  const observer = new QueryObserver(
    queryClient,
    teamAgentComputerAvailabilityQueryOptions('agent', true)
  );
  const unsubscribe = observer.subscribe(() => {});
  const { result, cleanup: unmount } = renderHook(
    useTeamAgentComputerMutation,
    {
      wrapper: (props) =>
        createComponent(QueryClientProvider, {
          client: queryClient,
          get children() {
            return props.children;
          },
        }),
    }
  );
  try {
    expect(authServiceClient.getTeamAgentComputer).not.toHaveBeenCalled();
    expect(await result.mutateAsync({ userId: 'agent' })).toBeNull();
    expect(
      queryClient.getQueryData(teamAgentKeys.computer('agent').queryKey)
    ).toBeNull();
    await vi.advanceTimersByTimeAsync(15000);
    expect(observer.getCurrentResult().data).toEqual(computer);
    expect(authServiceClient.getTeamAgentComputer).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30000);
    expect(authServiceClient.getTeamAgentComputer).toHaveBeenCalledTimes(2);
    observer.setOptions(
      teamAgentComputerAvailabilityQueryOptions('agent', false)
    );
    queryClient.setQueryData(teamAgentKeys.computer('agent').queryKey, null);
    await vi.advanceTimersByTimeAsync(30000);
    expect(authServiceClient.getTeamAgentComputer).toHaveBeenCalledTimes(2);
  } finally {
    unmount();
    unsubscribe();
    queryClient.clear();
    vi.useRealTimers();
    cleanup();
  }
});

it('query discovery keeps a 500 error distinct from unavailable', async () => {
  vi.mocked(authServiceClient.getTeamAgentComputer).mockResolvedValue(
    err([{ code: 'SERVER_ERROR', message: 'Failure' }])
  );
  const client = new QueryClient();
  try {
    await expect(
      client.fetchQuery(teamAgentComputerQueryOptions('agent', true))
    ).rejects.toThrow('Failure');
    expect(
      client.getQueryData(teamAgentComputerQueryOptions('agent', true).queryKey)
    ).toBeUndefined();
  } finally {
    client.clear();
  }
});

it('does not retain computer actions or start discovery after its row is disposed', async () => {
  const { queryClient } = await import('../client');
  queryClient.clear();
  vi.mocked(authServiceClient.getTeamAgentComputer).mockClear();
  const { result, cleanup: unmount } = renderHook(
    () =>
      useTeamAgentComputerAvailability(
        () => 'agent',
        () => true
      ),
    {
      wrapper: (props) =>
        createComponent(QueryClientProvider, {
          client: queryClient,
          get children() {
            return props.children;
          },
        }),
    }
  );
  expect(result()).toBe(true);
  unmount();
  expect(result()).toBe(false);
  expect(authServiceClient.getTeamAgentComputer).not.toHaveBeenCalled();
  queryClient.clear();
});

it('keeps a clicked unavailable result authoritative over earlier in-flight reads', async () => {
  const { queryClient } = await import('../client');
  const { teamAgentKeys } = await import('./keys');
  type DiscoveryResult = Awaited<
    ReturnType<typeof authServiceClient.getTeamAgentComputer>
  >;
  let finishOld: ((value: DiscoveryResult) => void) | undefined;
  let finishClick: ((value: DiscoveryResult) => void) | undefined;
  vi.mocked(authServiceClient.getTeamAgentComputer).mockReset();
  queryClient.clear();
  vi.mocked(authServiceClient.getTeamAgentComputer)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finishOld = resolve;
      })
    )
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finishClick = resolve;
      })
    );
  const options = teamAgentComputerQueryOptions('agent', true);
  const oldRead = queryClient.fetchQuery(options).catch(() => undefined);
  const { result, cleanup: unmount } = renderHook(
    useTeamAgentComputerMutation,
    {
      wrapper: (props) =>
        createComponent(QueryClientProvider, {
          client: queryClient,
          get children() {
            return props.children;
          },
        }),
    }
  );
  try {
    const clicked = result.mutateAsync({ userId: 'agent' });
    await waitFor(() =>
      expect(authServiceClient.getTeamAgentComputer).toHaveBeenCalledTimes(2)
    );
    const duringRead = queryClient.fetchQuery(options).catch(() => undefined);
    expect(authServiceClient.getTeamAgentComputer).toHaveBeenCalledTimes(2);
    finishClick?.(
      err([{ code: 'COMPUTERS_UNAVAILABLE', message: 'No fleet' }])
    );
    expect(await clicked).toBeNull();
    const stale = ok({
      computerId: 'old-computer',
      harnessId: 'old-runtime',
      isAgentComputer: true,
    });
    finishOld?.(stale);
    await Promise.all([oldRead, duringRead]);
    expect(
      queryClient.getQueryData(teamAgentKeys.computer('agent').queryKey)
    ).toBeNull();
  } finally {
    unmount();
    queryClient.clear();
  }
});

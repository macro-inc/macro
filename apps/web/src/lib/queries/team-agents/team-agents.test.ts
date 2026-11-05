import type { TeamAgent } from '@service-auth/generated/schemas';
import { focusManager, QueryObserver } from '@tanstack/query-core';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@service-auth/client', () => ({
  authServiceClient: { quoteTeamAgent: vi.fn(), listTeamAgents: vi.fn() },
}));

import { authServiceClient } from '@service-auth/client';
import { QueryClient } from '@tanstack/solid-query';
import { teamAgentQuoteQueryOptions, teamAgentsQueryOptions } from './index';

describe('team agents queries', () => {
  it('scopes quotes by team and size and reads the server total', async () => {
    const quote = {
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

it('refreshes visible agent health after provisioning, recovers failure, and stops on an empty roster', async () => {
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
            status: 'failed',
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
    expect(observer.getCurrentResult().data?.agents[0].status).toBe('failed');
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

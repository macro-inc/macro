import type { TeamAgent } from '@service-auth/generated/schemas';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@service-auth/client', () => ({
  authServiceClient: { retryTeamAgent: vi.fn(), listTeamAgents: vi.fn() },
}));

import { authServiceClient } from '@service-auth/client';
import { queryClient } from '../client';
import { queryReadyGate } from '../gate';
import { teamKeys } from '../team/keys';
import { useRetryTeamAgentMutation, useTeamAgentsQuery } from './index';
import { teamAgentKeys } from './keys';

const failed: TeamAgent = {
  userId: 'agent-1',
  teamId: 'team-1',
  name: 'Assistant',
  email: 'agent@example.com',
  createdAt: '2026-01-01',
  status: 'failed',
  retryable: true,
  payment: 'paid',
  statusReason: 'Computer disconnected',
};

function RetryHarness() {
  const agents = useTeamAgentsQuery(
    () => 'team-1',
    () => true
  );
  const retry = useRetryTeamAgentMutation();
  const agent = () => (queryReadyGate(agents) ? agents.data.agents[0] : failed);
  return (
    <>
      <span role="status">{agent()?.status}</span>
      <span aria-label="Mutation state">{retry.status}</span>
      <button
        disabled={retry.isPending || agent()?.retryable !== true}
        onClick={() => retry.mutate({ teamId: 'team-1', userId: 'agent-1' })}
      >
        Retry
      </button>
      <span>{retry.isError ? 'Retry rejected' : ''}</span>
    </>
  );
}

beforeEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
  queryClient.setQueryData(teamAgentKeys.list('team-1').queryKey, {
    agents: [structuredClone(failed)],
  });
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
});

it('retries the existing agent once, invalidates members, and exposes provisioning for polling', async () => {
  let finish: (() => void) | undefined;
  const provisioning: TeamAgent = {
    ...failed,
    status: 'provisioning',
    retryable: false,
    payment: 'paid',
  };
  vi.mocked(authServiceClient.retryTeamAgent).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(ok(provisioning));
      })
  );
  vi.mocked(authServiceClient.listTeamAgents).mockResolvedValue(
    ok({ agents: [provisioning] })
  );
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  render(() => (
    <QueryClientProvider client={queryClient}>
      <RetryHarness />
    </QueryClientProvider>
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() =>
    expect(authServiceClient.retryTeamAgent).toHaveBeenCalledTimes(1)
  );
  expect(
    screen.getByRole('button', { name: 'Retry' }).hasAttribute('disabled')
  ).toBe(true);
  finish?.();
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toBe('provisioning')
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Mutation state').textContent).toBe('success')
  );
  expect(authServiceClient.retryTeamAgent).toHaveBeenCalledWith('agent-1');
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: teamKeys.detail('team-1').queryKey,
  });
  expect(authServiceClient.listTeamAgents).toHaveBeenCalledTimes(1);
});

it('refreshes a stale failed row on 409 without replaying the retry request', async () => {
  vi.mocked(authServiceClient.retryTeamAgent).mockResolvedValue(
    err([{ code: 'CONFLICT', message: 'Agent is not failed' }])
  );
  vi.mocked(authServiceClient.listTeamAgents).mockResolvedValue(
    ok({ agents: [{ ...failed, status: 'running', retryable: false }] })
  );
  render(() => (
    <QueryClientProvider client={queryClient}>
      <RetryHarness />
    </QueryClientProvider>
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toBe('running')
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Mutation state').textContent).toBe('error')
  );
  expect(authServiceClient.retryTeamAgent).toHaveBeenCalledTimes(1);
  expect(authServiceClient.listTeamAgents).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole('button', { name: 'Retry' }).hasAttribute('disabled')
  ).toBe(true);
});

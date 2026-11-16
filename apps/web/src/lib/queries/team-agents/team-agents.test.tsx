/**
 * @vitest-environment jsdom
 */

import type { TeamAgent, TeamAgents } from '@service-auth/team-agents';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let testQueryClient: QueryClient;

vi.mock('../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

vi.mock('@service-auth/team-agents', () => ({
  teamAgentsClient: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
}));

import { teamAgentsClient } from '@service-auth/team-agents';
import { teamAgentKeys } from './keys';
import {
  teamAgentsPollInterval,
  useCreateTeamAgentMutation,
  useRemoveTeamAgentMutation,
} from './team-agents';

const ada: TeamAgent = {
  userId: 'macro|ada@agents.macro.invalid',
  teamId: 'team-1',
  name: 'Ada',
  jobDescription: 'Triage support email.',
  personality: 'Warm.',
  createdBy: 'macro|admin@example.com',
  computerId: null,
  status: 'provisioning',
  createdAt: '2026-11-11T00:00:00Z',
};

const grace: TeamAgent = {
  ...ada,
  userId: 'macro|grace@agents.macro.invalid',
  name: 'Grace',
  status: 'running',
};

let dispose: (() => void) | undefined;

function renderHook<T>(factory: () => T): T {
  let hook!: T;
  dispose = render(
    () => (
      <QueryClientProvider client={testQueryClient}>
        {(() => {
          hook = factory();
          return null as unknown as JSX.Element;
        })()}
      </QueryClientProvider>
    ),
    document.body
  );
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  testQueryClient.clear();
});

describe('teamAgentsPollInterval', () => {
  it('polls while an agent is provisioning and stops once none are', () => {
    expect(teamAgentsPollInterval([grace, ada])).toBe(3000);
    expect(teamAgentsPollInterval([grace])).toBe(false);
    expect(teamAgentsPollInterval(undefined)).toBe(false);
  });
});

describe('team agent mutations', () => {
  it('adds the invited agent to the roster and refreshes the team', async () => {
    testQueryClient.setQueryData<TeamAgents>(
      teamAgentKeys.list('team-1').queryKey,
      { agents: [grace] }
    );
    vi.mocked(teamAgentsClient.create).mockResolvedValue(ok(ada));
    const invalidateQueries = vi.spyOn(testQueryClient, 'invalidateQueries');
    const mutation = renderHook(() => useCreateTeamAgentMutation());

    await mutation.mutateAsync({
      teamId: 'team-1',
      request: {
        name: 'Ada',
        jobDescription: 'Triage support email.',
        personality: 'Warm.',
        size: 'standard',
        avatarUrl: null,
        purchaseKey: 'purchase-1',
      },
    });

    expect(
      testQueryClient.getQueryData<TeamAgents>(
        teamAgentKeys.list('team-1').queryKey
      )
    ).toEqual({ agents: [grace, ada] });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['team', 'detail', 'team-1'],
    });
  });

  it('drops a removed agent from the roster', async () => {
    testQueryClient.setQueryData<TeamAgents>(
      teamAgentKeys.list('team-1').queryKey,
      { agents: [grace, ada] }
    );
    vi.mocked(teamAgentsClient.remove).mockResolvedValue(ok({}));
    const mutation = renderHook(() => useRemoveTeamAgentMutation());

    await mutation.mutateAsync({ teamId: 'team-1', userId: ada.userId });

    expect(teamAgentsClient.remove).toHaveBeenCalledWith(ada.userId);
    expect(
      testQueryClient.getQueryData<TeamAgents>(
        teamAgentKeys.list('team-1').queryKey
      )
    ).toEqual({ agents: [grace] });
  });
});

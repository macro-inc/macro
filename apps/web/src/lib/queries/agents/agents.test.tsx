/**
 * @vitest-environment jsdom
 */

import { storageServiceClient } from '@service-storage/client';
import type { Agent } from '@service-storage/generated/schemas/agent';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { channelKeys } from '../channel/keys';
import { agentKeys } from './keys';

let testQueryClient: QueryClient;

vi.mock('../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    createAgent: vi.fn(),
    deleteBot: vi.fn(),
    updateAgent: vi.fn(),
  },
}));

import {
  type CreateAgentParams,
  useCreateAgentMutation,
  useDeleteAgentMutation,
  useUpdateAgentMutation,
} from './agents';

const params: CreateAgentParams = {
  channelIds: ['channel-new'],
  channelScope: 'selected',
  defaultModel: 'claude-sonnet-4-5',
  handle: 'bug-fixer',
  harness: 'in-memory',
  name: 'Bug fixer',
  instructions: 'Fix bugs.',
  mcp: { scope: 'owner_connections' },
};

function agent(channelIds: string[]): Agent {
  return {
    bot: {
      id: 'agent-1',
      kind: 'owned',
      owner: { type: 'user', user_id: 'macro|user@example.com' },
      name: 'Bug fixer',
      handle: 'bug-fixer',
      has_agent: true,
      created_at: '2026-08-27T12:00:00Z',
      updated_at: '2026-08-27T12:00:00Z',
    },
    instructions: 'Fix bugs.',
    harness: 'in-memory',
    default_model: 'claude-sonnet-4-5',
    channel_scope: 'selected',
    channel_ids: channelIds,
    mcp: { scope: 'owner_connections' },
  };
}

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

describe('agent channel-bot cache invalidation', () => {
  it('invalidates selected channel bot queries after creation', async () => {
    const created = agent(['channel-new', 'channel-other']);
    vi.mocked(storageServiceClient.createAgent).mockResolvedValue(ok(created));
    const invalidateQueries = vi.spyOn(testQueryClient, 'invalidateQueries');
    const mutation = renderHook(() => useCreateAgentMutation());

    await mutation.mutateAsync(params);

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: channelKeys.channelBots('channel-new').queryKey,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: channelKeys.channelBots('channel-other').queryKey,
    });
  });

  it('invalidates old and new channel bot queries after editing', async () => {
    testQueryClient.setQueryData(agentKeys.list.queryKey, [
      agent(['channel-old']),
    ]);
    const updated = agent(['channel-new']);
    vi.mocked(storageServiceClient.updateAgent).mockResolvedValue(ok(updated));
    const invalidateQueries = vi.spyOn(testQueryClient, 'invalidateQueries');
    const mutation = renderHook(() => useUpdateAgentMutation());

    await mutation.mutateAsync({ ...params, agentId: 'agent-1' });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: channelKeys.channelBots('channel-old').queryKey,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: channelKeys.channelBots('channel-new').queryKey,
    });
  });

  it('removes a deleted agent and invalidates its channel bot queries', async () => {
    const existing = agent(['channel-old']);
    testQueryClient.setQueryData(agentKeys.list.queryKey, [existing]);
    vi.mocked(storageServiceClient.deleteBot).mockResolvedValue(ok(undefined));
    const invalidateQueries = vi.spyOn(testQueryClient, 'invalidateQueries');
    const mutation = renderHook(() => useDeleteAgentMutation());

    await mutation.mutateAsync({
      agentId: existing.bot.id,
      channelIds: existing.channel_ids,
    });

    expect(storageServiceClient.deleteBot).toHaveBeenCalledWith({
      bot_id: 'agent-1',
    });
    expect(
      testQueryClient.getQueryData<Agent[]>(agentKeys.list.queryKey)
    ).toEqual([]);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: channelKeys.channelBots('channel-old').queryKey,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: channelKeys.participants('channel-old').queryKey,
    });
  });
});

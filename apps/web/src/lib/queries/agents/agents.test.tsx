/**
 * @vitest-environment jsdom
 */

import { staticFileIdEndpoint } from '@core/constant/servers';
import { createStaticUploadFile } from '@core/util/uploadFile';
import { storageServiceClient } from '@service-storage/client';
import type { Agent } from '@service-storage/generated/schemas/agent';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { botKeys, botProfileKeys } from '../bots/keys';
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

vi.mock('@core/util/uploadFile', () => ({
  createUploadFile: (file: File) => ({ kind: 'browser', file }),
  createStaticUploadFile: vi.fn(),
}));

import {
  type CreateAgentParams,
  useCreateAgentMutation,
  useDeleteAgentMutation,
  useUpdateAgentMutation,
} from './agents';
import { useUploadAgentAvatarMutation } from './avatar';

const params: CreateAgentParams = {
  channelIds: ['channel-new'],
  channelScope: 'selected',
  defaultModel: 'claude-sonnet-4-5',
  handle: 'bug-fixer',
  harness: 'in-memory',
  name: 'Bug fixer',
  instructions: 'Fix bugs.',
  isCoding: false,
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
    is_coding: false,
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
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: botKeys.list.queryKey,
    });
    expect(
      testQueryClient.getQueryData(botKeys.detail(created.bot.id).queryKey)
    ).toEqual(created.bot);
  });

  it('invalidates old and new channel bot queries after editing', async () => {
    testQueryClient.setQueryData(agentKeys.list.queryKey, [
      agent(['channel-old']),
    ]);
    const updated = agent(['channel-new']);
    const profileKey = botProfileKeys.detail(updated.bot.id).queryKey;
    testQueryClient.setQueryData(profileKey, {
      name: 'Previous name',
      avatarUrl: undefined,
      deleted: false,
    });
    vi.mocked(storageServiceClient.updateAgent).mockResolvedValue(ok(updated));
    for (const id of ['channel-old', 'channel-new']) {
      testQueryClient.setQueryData(channelKeys.channelBots(id).queryKey, []);
    }
    const mutation = renderHook(() => useUpdateAgentMutation());

    await mutation.mutateAsync({ ...params, agentId: 'agent-1' });

    for (const id of ['channel-old', 'channel-new']) {
      expect(
        testQueryClient.getQueryState(channelKeys.channelBots(id).queryKey)
          ?.isInvalidated
      ).toBe(true);
    }
    expect(
      testQueryClient.getQueryData(botKeys.detail(updated.bot.id).queryKey)
    ).toEqual(updated.bot);
    expect(testQueryClient.getQueryState(profileKey)?.isInvalidated).toBe(true);
  });

  it('refreshes cached channel and bot profiles when a global team agent changes its avatar', async () => {
    const existing = { ...agent([]), channel_scope: 'all' as const };
    existing.bot.owner = { type: 'team', team_id: 'team-1' };
    const updated = {
      ...existing,
      bot: { ...existing.bot, avatar_url: 'https://static.example/avatar.png' },
    };
    testQueryClient.setQueryData(agentKeys.list.queryKey, [existing]);
    testQueryClient.setQueryData(botKeys.list.queryKey, [existing.bot]);
    testQueryClient.setQueryData(
      botKeys.detail(existing.bot.id).queryKey,
      existing.bot
    );
    testQueryClient.setQueryData(
      channelKeys.channelBots('channel-installed').queryKey,
      [existing.bot]
    );
    vi.mocked(storageServiceClient.updateAgent).mockResolvedValue(ok(updated));
    const mutation = renderHook(() => useUpdateAgentMutation());
    await mutation.mutateAsync({
      ...params,
      agentId: existing.bot.id,
      avatarUrl: updated.bot.avatar_url,
      channelScope: 'all',
      channelIds: [],
      teamId: 'team-1',
    });
    expect(storageServiceClient.updateAgent).toHaveBeenCalledWith(
      expect.objectContaining({ avatar_url: updated.bot.avatar_url })
    );
    expect(testQueryClient.getQueryData(agentKeys.list.queryKey)).toEqual([
      updated,
    ]);
    expect(
      testQueryClient.getQueryData(botKeys.detail(existing.bot.id).queryKey)
    ).toEqual(updated.bot);
    expect(
      testQueryClient.getQueryState(botKeys.list.queryKey)?.isInvalidated
    ).toBe(true);
    expect(
      testQueryClient.getQueryState(
        channelKeys.channelBots('channel-installed').queryKey
      )?.isInvalidated
    ).toBe(true);
  });

  it('removes a deleted agent and invalidates its channel bot queries', async () => {
    const existing = agent(['channel-old']);
    testQueryClient.setQueryData(agentKeys.list.queryKey, [existing]);
    const profileKey = botProfileKeys.detail(existing.bot.id).queryKey;
    testQueryClient.setQueryData(profileKey, {
      name: existing.bot.name,
      avatarUrl: undefined,
      deleted: false,
    });
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
    expect(testQueryClient.getQueryState(profileKey)?.isInvalidated).toBe(true);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: channelKeys.channelBots('channel-old').queryKey,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: channelKeys.participants('channel-old').queryKey,
    });
  });
});

describe('agent avatar uploads', () => {
  it('uploads image bytes and returns the durable URL for the agent save', async () => {
    vi.mocked(createStaticUploadFile).mockResolvedValue('file-id');
    const mutation = renderHook(() => useUploadAgentAvatarMutation());
    // This exceeds the JSON endpoint body limit when encoded as a data URL.
    const file = new File([new Uint8Array(3 * 1024 * 1024)], 'avatar.png', {
      type: 'image/png',
    });
    await expect(mutation.mutateAsync(file)).resolves.toBe(
      staticFileIdEndpoint('file-id')
    );
    expect(createStaticUploadFile).toHaveBeenCalledWith({
      kind: 'browser',
      file,
    });
  });

  it('rejects oversized images before starting an upload', async () => {
    const mutation = renderHook(() => useUploadAgentAvatarMutation());
    const file = new File(
      [new Uint8Array(16 * 1000 * 1000 + 1)],
      'avatar.png',
      { type: 'image/png' }
    );
    await expect(mutation.mutateAsync(file)).rejects.toThrow('maximum 16 MB');
    expect(createStaticUploadFile).not.toHaveBeenCalled();
  });

  it('propagates upload errors without returning an avatar URL', async () => {
    vi.mocked(createStaticUploadFile).mockRejectedValue(
      new Error('Failed to upload file')
    );
    const mutation = renderHook(() => useUploadAgentAvatarMutation());
    await expect(
      mutation.mutateAsync(new File(['avatar'], 'avatar.png'))
    ).rejects.toThrow('Failed to upload file');
  });
});

/**
 * @vitest-environment jsdom
 */

import { storageServiceClient } from '@service-storage/client';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let testQueryClient: QueryClient;
vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    addBotToChannel: vi.fn(),
    removeBotFromChannel: vi.fn(),
  },
}));
vi.mock('@queries/bots/bots', () => ({
  invalidateBotChannels: vi.fn(async () => {}),
  invalidateBots: vi.fn(async () => {}),
}));
const revalidateMentionableBots = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@queries/bots/graphql-bots', () => ({ revalidateMentionableBots }));

import {
  useAddBotToChannelMutation,
  useRemoveBotFromChannelMutation,
} from '../channel-bots';

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
    defaultOptions: { mutations: { retry: false } },
  });
  vi.mocked(storageServiceClient.addBotToChannel).mockResolvedValue(
    ok(undefined as never)
  );
  vi.mocked(storageServiceClient.removeBotFromChannel).mockResolvedValue(
    ok(undefined as never)
  );
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

describe('channel bot membership', () => {
  it('rereads the channel’s @ menu after inviting a bot', async () => {
    const mutation = renderHook(() => useAddBotToChannelMutation());
    await mutation.mutateAsync({ channelId: 'channel-1', botId: 'bot-1' });
    expect(revalidateMentionableBots).toHaveBeenCalledWith(['channel-1']);
  });

  it('rereads the channel’s @ menu after removing a bot', async () => {
    const mutation = renderHook(() => useRemoveBotFromChannelMutation());
    await mutation.mutateAsync({ channelId: 'channel-1', botId: 'bot-1' });
    expect(revalidateMentionableBots).toHaveBeenCalledWith(['channel-1']);
  });
});

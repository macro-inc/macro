/**
 * @vitest-environment jsdom
 */

import type { MessageSender } from '@service-storage/messages';
import { until } from '@solid-primitives/promise';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentKeys } from '../agents/keys';
import { channelKeys } from '../channel/keys';
import { botKeys, botProfileKeys } from './keys';

let testQueryClient: QueryClient;

vi.mock('../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

const getBotOwnerProfiles = vi.fn();

vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    getBotOwnerProfiles: (...args: unknown[]) => getBotOwnerProfiles(...args),
  },
}));

import { handleBotProfileChanged } from './profile-sync';
import { useLiveBotSender } from './profiles';

const RELEASE_BOT = '5f0c8a4e-2d1b-4c3a-9e7f-6a5b4c3d2e1f';

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
  getBotOwnerProfiles.mockReset();
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  testQueryClient.clear();
});

describe('handleBotProfileChanged', () => {
  it('shows the pushed name and picture on a message sent before the change', async () => {
    const sentBeforeRename: MessageSender = {
      type: 'bot',
      id: RELEASE_BOT,
      name: 'Release bot',
      avatar_url: null,
    };
    const sender = renderHook(() => useLiveBotSender(() => sentBeforeRename));

    expect(sender()).toEqual(sentBeforeRename);
    expect(getBotOwnerProfiles).not.toHaveBeenCalled();

    handleBotProfileChanged({
      id: RELEASE_BOT,
      name: 'Shipper',
      avatar_url: 'https://static.example/shipper.png',
      deleted_at: null,
      owner: { type: 'user', user_id: 'macro|owner@example.com' },
    });
    // Solid Query hands a cache change to its observers asynchronously.
    await until(() => sender().name === 'Shipper');

    expect(sender()).toEqual({
      type: 'bot',
      id: RELEASE_BOT,
      name: 'Shipper',
      avatar_url: 'https://static.example/shipper.png',
    });
  });

  it('refreshes the agent and channel bot lists the mention menu reads', () => {
    testQueryClient.setQueryData(agentKeys.list.queryKey, []);
    testQueryClient.setQueryData(botKeys.list.queryKey, []);
    testQueryClient.setQueryData(
      channelKeys.channelBots('channel-1').queryKey,
      []
    );

    handleBotProfileChanged({
      id: RELEASE_BOT,
      name: 'Shipper',
      avatar_url: null,
      deleted_at: null,
      owner: { type: 'user', user_id: 'macro|owner@example.com' },
    });

    expect(
      testQueryClient.getQueryState(agentKeys.list.queryKey)?.isInvalidated
    ).toBe(true);
    expect(
      testQueryClient.getQueryState(botKeys.list.queryKey)?.isInvalidated
    ).toBe(true);
    expect(
      testQueryClient.getQueryState(
        channelKeys.channelBots('channel-1').queryKey
      )?.isInvalidated
    ).toBe(true);
    expect(
      testQueryClient.getQueryData(botProfileKeys.detail(RELEASE_BOT).queryKey)
    ).toEqual({ name: 'Shipper', avatarUrl: undefined, deleted: false });
  });
});

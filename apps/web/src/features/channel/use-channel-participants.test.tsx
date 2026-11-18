import { cleanup, render, screen } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { Suspense } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const detail = vi.hoisted(() => ({
  pending: true,
  entities: [] as unknown[],
  listeners: new Set<() => void>(),
  enabled: [] as boolean[],
}));
vi.mock('@queries/channel/detail', async () => {
  const { createSignal } = await import('solid-js');
  const [version, setVersion] = createSignal(0);
  detail.listeners.add(() => setVersion((value) => value + 1));
  return {
    createChannelDetailQuery: (
      _channelId: () => string,
      enabled: () => boolean
    ) => {
      detail.enabled.push(enabled());
      return {
        get isPending() {
          version();
          return detail.pending;
        },
        isLoading: false,
        get data() {
          version();
          return detail.pending ? undefined : { entities: detail.entities };
        },
      };
    },
  };
});
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({}),
}));

import { useChannelParticipants } from './use-channel-participants';

afterEach(() => {
  cleanup();
  detail.pending = true;
  detail.entities = [];
  detail.enabled = [];
});

function mount(channelId: string) {
  const client = new QueryClient();
  function View() {
    const participants = useChannelParticipants(() => channelId);
    return (
      <div data-testid="content">
        {participants
          .users()
          .map((user) => user.id)
          .join(',')}
        |{participants.ids().join(',')}
      </div>
    );
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Suspense fallback={<div data-testid="suspended" />}>
        <View />
      </Suspense>
    </QueryClientProvider>
  ));
}

function expectContent(text: string) {
  expect(screen.queryByTestId('suspended')).toBeNull();
  expect(screen.getByTestId('content').textContent).toBe(text);
}

describe('useChannelParticipants', () => {
  it('does not suspend or read without a channel, as on a document composer', () => {
    mount('');
    expectContent('|');
    expect(detail.enabled).toEqual([false]);
  });

  it('lists the participants once the channel record loads, without suspending', () => {
    mount('channel-1');
    expectContent('|');

    detail.pending = false;
    detail.entities = [
      {
        id: 'channel-1',
        type: 'channel',
        participants: [
          {
            channel_id: 'channel-1',
            joined_at: '2026-09-24T12:00:00Z',
            role: 'member',
            user_id: 'macro|a@macro.com',
          },
        ],
      },
    ];
    for (const listener of detail.listeners) listener();

    expectContent('macro|a@macro.com|macro|a@macro.com');
  });
});

import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { Suspense } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChannelParticipants } from './use-channel-participants';

vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});
const network = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupNetworkClient: () => network,
}));

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.clearAllMocks();
});

function mount(channelId: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
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
  it('does not suspend without a channel, as on a document composer', () => {
    mount('');
    expectContent('|');
    expect(network.query).not.toHaveBeenCalled();
  });

  it('lists the participants once they load, without suspending', async () => {
    let answer: (result: unknown) => void = () => {};
    network.query.mockReturnValue({
      subscribe: (onResult: (result: unknown) => void) => {
        answer = onResult;
        return { unsubscribe: () => {} };
      },
    });
    mount('channel-1');
    expectContent('|');
    answer({
      data: {
        user: {
          id: 'macro|a@macro.com',
          soupEntity: {
            id: 'channel-1',
            participants: [
              {
                channelId: 'channel-1',
                joinedAt: '2026-09-24T12:00:00+00:00',
                leftAt: null,
                role: 'member',
                userId: 'macro|a@macro.com',
              },
            ],
          },
        },
      },
      error: undefined,
    });
    await waitFor(() => expectContent('macro|a@macro.com|macro|a@macro.com'));
  });
});

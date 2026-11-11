import { storageServiceClient } from '@service-storage/client';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { Suspense } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChannelParticipants } from './use-channel-participants';

vi.mock('@queries/client', () => ({ queryClient: {} }));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { getChannelParticipants: vi.fn() },
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
    expect(storageServiceClient.getChannelParticipants).not.toHaveBeenCalled();
  });

  it('lists the participants once they load, without suspending', async () => {
    const response =
      Promise.withResolvers<
        Awaited<ReturnType<typeof storageServiceClient.getChannelParticipants>>
      >();
    vi.mocked(storageServiceClient.getChannelParticipants).mockReturnValue(
      response.promise
    );
    mount('channel-1');
    expectContent('|');
    response.resolve(
      ok([
        {
          channel_id: 'channel-1',
          joined_at: '2026-09-24T12:00:00Z',
          role: 'member',
          user_id: 'macro|a@macro.com',
        },
      ])
    );
    await waitFor(() => expectContent('macro|a@macro.com|macro|a@macro.com'));
  });
});

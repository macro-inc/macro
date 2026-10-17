/** @vitest-environment jsdom */

import { storageServiceClient } from '@service-storage/client';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let client: QueryClient;
let dispose: () => void;
vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    getOrCreateDirectMessage: vi.fn(),
    getOrCreatePrivateChannel: vi.fn(),
  },
}));
vi.mock('../channels', () => ({ invalidateListChannels: vi.fn() }));

import {
  useGetOrCreateDirectMessageMutation,
  useGetOrCreatePrivateChannelMutation,
} from '../get-or-create-dm';

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
});
afterEach(() => {
  dispose?.();
  client.clear();
});

it('finds a direct message and a group inside the caller span', async () => {
  let inSpan = false;
  const trace = {
    run: <T,>(operation: () => T): T => {
      inSpan = true;
      try {
        return operation();
      } finally {
        inSpan = false;
      }
    },
  };
  const requests: [string, boolean][] = [];
  vi.mocked(storageServiceClient.getOrCreateDirectMessage).mockImplementation(
    async () => {
      requests.push(['direct', inSpan]);
      return ok({ action: 'get', channel_id: 'dm-1' });
    }
  );
  vi.mocked(storageServiceClient.getOrCreatePrivateChannel).mockImplementation(
    async () => {
      requests.push(['group', inSpan]);
      return ok({ action: 'create', channel_id: 'group-1' });
    }
  );
  let direct!: ReturnType<typeof useGetOrCreateDirectMessageMutation>;
  let group!: ReturnType<typeof useGetOrCreatePrivateChannelMutation>;
  function Fixture() {
    direct = useGetOrCreateDirectMessageMutation();
    group = useGetOrCreatePrivateChannelMutation();
    return null;
  }
  dispose = render(
    () => (
      <QueryClientProvider client={client}>
        <Fixture />
      </QueryClientProvider>
    ),
    document.body
  );

  const found = [
    await direct.mutateAsync({ recipient_id: 'ana', trace }),
    await group.mutateAsync({ recipients: ['ana', 'ben'], trace }),
  ];

  expect(found.map(({ channel_id }) => channel_id)).toEqual([
    'dm-1',
    'group-1',
  ]);
  expect(requests).toEqual([
    ['direct', true],
    ['group', true],
  ]);
});

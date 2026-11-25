/** @vitest-environment jsdom */

import { storageServiceClient } from '@service-storage/client';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let client: QueryClient;
let dispose: (() => void) | undefined;
const directory = vi.hoisted(() => ({
  refreshChannelDirectory: vi.fn(async (_ids?: readonly string[]) => {}),
}));
vi.mock('../../client', () => ({
  get queryClient() {
    return client;
  },
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    getOrCreateDirectMessage: vi.fn(),
    getOrCreatePrivateChannel: vi.fn(),
  },
}));
vi.mock('../directory', () => ({
  refreshChannelDirectory: directory.refreshChannelDirectory,
}));
// The hooks' identity comes from the app's user context; the account they
// capture is the one the test signs in.
vi.mock('../../auth/use-query-account', async () => {
  const { currentQueryAccount } = await import('../../auth/account-scope');
  return { useQueryAccount: () => () => currentQueryAccount() };
});

import { authKeys } from '../../auth/keys';
import {
  getOrCreateDirectMessageChannel,
  useGetOrCreateDirectMessageMutation,
  useGetOrCreatePrivateChannelMutation,
} from '../get-or-create-dm';

function signIn(userId: string) {
  client.setQueryData(authKeys.userInfo.queryKey, {
    id: userId,
    authenticated: true,
  });
}

function mountConversationMutations() {
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
  return { direct, group };
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  signIn('viewer');
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  client.clear();
});

it('finds a direct message and a group inside the caller span', async () => {
  let inSpan = false;
  const parentSpan = {
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
  const { direct, group } = mountConversationMutations();

  const found = [
    await direct.mutateAsync({ recipient_id: 'ana', parentSpan }),
    await group.mutateAsync({ recipients: ['ana', 'ben'], parentSpan }),
  ];

  expect(found.map(({ channel_id }) => channel_id)).toEqual([
    'dm-1',
    'group-1',
  ]);
  expect(requests).toEqual([
    ['direct', true],
    ['group', true],
  ]);
  expect(directory.refreshChannelDirectory.mock.calls).toEqual([
    [['dm-1']],
    [['group-1']],
  ]);
});

type Found = Awaited<
  ReturnType<typeof storageServiceClient.getOrCreateDirectMessage>
>;

/** Waits for `work` to settle; a failed mutation rejects, and these tests
 * read what its settling did. */
async function settled(work: Promise<unknown>) {
  await work.catch(() => undefined);
}

const KINDS = [
  [
    'a direct message',
    () => storageServiceClient.getOrCreateDirectMessage,
    () =>
      settled(
        mountConversationMutations().direct.mutateAsync({ recipient_id: 'ana' })
      ),
  ],
  [
    'a group',
    () => storageServiceClient.getOrCreatePrivateChannel,
    () =>
      settled(
        mountConversationMutations().group.mutateAsync({
          recipients: ['ana', 'ben'],
        })
      ),
  ],
  [
    'a direct message found outside a mutation',
    () => storageServiceClient.getOrCreateDirectMessage,
    async () => {
      await getOrCreateDirectMessageChannel('agent');
    },
  ],
] as const;

// A mutation admitted by one sign-in can settle in its replacement: the
// directory it would read the conversation into is gone, and a read then
// would run as the replacement.
describe('in another sign-in', () => {
  it.each(KINDS)(
    'leaves the directory alone when %s settles',
    async (_name, call, start) => {
      let answer!: (value: Found) => void;
      const pending = new Promise<Found>((resolve) => {
        answer = resolve;
      });
      vi.mocked(call()).mockReturnValue(pending as never);

      const done = start();
      await vi.waitFor(() => expect(call()).toHaveBeenCalled());
      signIn('someone-else');
      answer(ok({ action: 'create', channel_id: 'dm-1' }));
      await done;

      expect(directory.refreshChannelDirectory).not.toHaveBeenCalled();
    }
  );

  it.each(KINDS)(
    'reads %s into the directory when the sign-in stays',
    async (_name, call, start) => {
      vi.mocked(call()).mockResolvedValue(
        ok({ action: 'create', channel_id: 'dm-1' }) as never
      );

      await start();

      expect(directory.refreshChannelDirectory).toHaveBeenCalledExactlyOnceWith(
        ['dm-1']
      );
    }
  );
});

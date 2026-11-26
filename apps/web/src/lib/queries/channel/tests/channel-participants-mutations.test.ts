import { storageServiceClient } from '@service-storage/client';
import { MutationObserver, QueryClient } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let testQueryClient: QueryClient;
const directory = vi.hoisted(() => ({
  refreshChannelDirectory: vi.fn(async (_ids?: readonly string[]) => {}),
}));

vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn(), success: vi.fn() },
}));

vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    addParticipantsToChannel: vi.fn(),
    removeParticipantsFromChannel: vi.fn(),
  },
}));

vi.mock('../directory', () => ({
  refreshChannelDirectory: directory.refreshChannelDirectory,
}));

import { authKeys } from '../../auth/keys';
import { channelKeys } from '../keys';
import {
  addParticipantsMutationOptions,
  removeParticipantsMutationOptions,
} from '../participants';

function signIn(userId: string) {
  testQueryClient.setQueryData(authKeys.userInfo.queryKey, {
    id: userId,
    authenticated: true,
  });
}

function run<TVars>(
  options: ReturnType<
    | typeof addParticipantsMutationOptions
    | typeof removeParticipantsMutationOptions
  >,
  variables: TVars
) {
  const observer = new MutationObserver(testQueryClient, options as never);
  return observer.mutate(variables as never).catch(() => undefined);
}

const ROSTER = { channelId: 'channel-1', participants: ['macro|peer'] };

type Answer = Awaited<
  ReturnType<typeof storageServiceClient.addParticipantsToChannel>
>;

describe('channel roster changes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testQueryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    signIn('viewer');
  });

  // The directory's record carries the roster that call and DM Work members
  // and DM peers read; without a read of it, the change waits for the soup
  // update (with the cache) or the five-minute stale time (without).
  it('reads the channel into the directory after adding people', async () => {
    vi.mocked(storageServiceClient.addParticipantsToChannel).mockResolvedValue(
      ok({ message: 'ok' })
    );
    const invalidate = vi.spyOn(testQueryClient, 'invalidateQueries');

    await run(addParticipantsMutationOptions(), ROSTER);

    expect(directory.refreshChannelDirectory).toHaveBeenCalledExactlyOnceWith([
      'channel-1',
    ]);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: channelKeys.participants('channel-1').queryKey,
      refetchType: 'inactive',
    });
  });

  it('reads the channel into the directory after removing people', async () => {
    vi.mocked(
      storageServiceClient.removeParticipantsFromChannel
    ).mockResolvedValue(ok({ message: 'ok' }));

    await run(removeParticipantsMutationOptions(), ROSTER);

    expect(directory.refreshChannelDirectory).toHaveBeenCalledExactlyOnceWith([
      'channel-1',
    ]);
  });

  // A failed response can follow a change the server made (a timeout after
  // the write), so the channel is read either way, as the participants list
  // always was.
  it('reads the channel after a failed change too', async () => {
    vi.mocked(
      storageServiceClient.removeParticipantsFromChannel
    ).mockResolvedValue(err([{ code: 'SERVER_ERROR', message: 'down' }]));

    await run(removeParticipantsMutationOptions(), ROSTER);

    expect(directory.refreshChannelDirectory).toHaveBeenCalledExactlyOnceWith([
      'channel-1',
    ]);
  });

  // The participants list is keyed by channel only, and a new sign-in reads
  // every query again: a change admitted before it settles without touching
  // what the new sign-in shows.
  it('leaves the caches alone when the change settles in another sign-in', async () => {
    let answer!: (
      value: Awaited<
        ReturnType<typeof storageServiceClient.addParticipantsToChannel>
      >
    ) => void;
    vi.mocked(storageServiceClient.addParticipantsToChannel).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    const invalidate = vi.spyOn(testQueryClient, 'invalidateQueries');

    const settled = run(addParticipantsMutationOptions(), ROSTER);
    await vi.waitFor(() =>
      expect(storageServiceClient.addParticipantsToChannel).toHaveBeenCalled()
    );
    signIn('someone-else');
    answer(ok({ message: 'ok' }));
    await settled;

    expect(directory.refreshChannelDirectory).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it.each([
    ['adding', 'add'],
    ['removing', 'remove'],
  ] as const)(
    'keeps what another sign-in read after %s people fails',
    async (_name, kind) => {
      const participantsKey = channelKeys.participants('channel-1').queryKey;
      const member = (userId: string) => ({
        user_id: userId,
        role: 'member' as const,
        left_at: null,
        joined_at: '2026-11-01T00:00:00.000Z',
        channel_id: 'channel-1',
      });
      // Before: the peer is out to add, or in to remove.
      testQueryClient.setQueryData(
        participantsKey,
        kind === 'add'
          ? [member('viewer')]
          : [member('viewer'), member('macro|peer')]
      );
      let answer!: (value: Answer) => void;
      const pending = new Promise<Answer>((resolve) => {
        answer = resolve;
      });
      const call =
        kind === 'add'
          ? storageServiceClient.addParticipantsToChannel
          : storageServiceClient.removeParticipantsFromChannel;
      vi.mocked(call).mockReturnValue(pending as never);

      const settled = run(
        kind === 'add'
          ? addParticipantsMutationOptions()
          : removeParticipantsMutationOptions(),
        ROSTER
      );
      await vi.waitFor(() => expect(call).toHaveBeenCalled());
      signIn('someone-else');
      // The new sign-in's own read of the roster, after the server applied
      // the change and before its answer failed.
      const fresh =
        kind === 'add'
          ? [member('viewer'), member('macro|peer')]
          : [member('viewer')];
      testQueryClient.setQueryData(participantsKey, fresh);
      answer(err([{ code: 'SERVER_ERROR', message: 'timeout' }]));
      await settled;

      expect(testQueryClient.getQueryData(participantsKey)).toEqual(fresh);
    }
  );
});

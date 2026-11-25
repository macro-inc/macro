import type { MessageParent } from '@service-storage/messages';
import { cleanup, render } from '@solidjs/testing-library';
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/solid-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let testQueryClient: QueryClient;
const mocks = vi.hoisted(() => ({
  host: { name: 'host' } as object | undefined,
  restReaders: new Set<string>(),
  device: {
    send: vi.fn(),
    edit: vi.fn(),
    remove: vi.fn(),
    react: vi.fn(),
  },
  rest: {
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    react: vi.fn(),
    get: vi.fn(),
  },
  track: vi.fn(),
  rollback: vi.fn(),
  refetchSoup: vi.fn(async () => {}),
}));
vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn() },
}));
vi.mock('@service-storage/messages', () => ({
  entityMessagesClient: mocks.rest,
}));
vi.mock('../local/channel-flag', () => ({
  channelCacheHostFor: (parent: MessageParent) =>
    parent.type === 'channel' && !mocks.restReaders.has(parent.id)
      ? mocks.host
      : undefined,
}));
vi.mock('../local/channel-sync', () => ({
  channelWrites: () => mocks.device,
}));
vi.mock('@queries/soup/normalized-cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@queries/soup/normalized-cache')>()),
  optimisticUpdateSoupItemUpdatedAt: () => ({ rollback: mocks.rollback }),
  refetchSoupEntity: mocks.refetchSoup,
  bumpSoupEntityTouchedAt: () => {},
  invalidateSoupEntity: () => {},
}));
vi.mock('@queries/soup/crm-association', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@queries/soup/crm-association')>()),
  refreshCrmAssociatedSoupQueries: async () => {},
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: mocks.track }),
}));

import { toast } from '@core/component/Toast/Toast';
import {
  useDeleteMessageMutation,
  usePatchMessageMutation,
  useSendMessageMutation,
} from '../mutations';
import {
  useAddReactionMutation,
  useRemoveReactionMutation,
} from '../reactions';

const CHANNEL: MessageParent = { type: 'channel', id: 'channel-1' };
const DOCUMENT: MessageParent = { type: 'document', id: 'document-1' };
const SENDER = 'macro|sender@example.test';

function message(parent: MessageParent, id: string) {
  const time = '2026-11-01T10:00:00Z';
  return {
    id,
    parent,
    sender_id: SENDER,
    content: id,
    mentions: [],
    attachments: [],
    reactions: [],
    created_at: time,
    updated_at: time,
  };
}

/** Every message write a view can make. */
function mountWrites() {
  let writes!: {
    send: ReturnType<typeof useSendMessageMutation>;
    edit: ReturnType<typeof usePatchMessageMutation>;
    remove: ReturnType<typeof useDeleteMessageMutation>;
    addReaction: ReturnType<typeof useAddReactionMutation>;
    removeReaction: ReturnType<typeof useRemoveReactionMutation>;
  };
  function Probe() {
    writes = {
      send: useSendMessageMutation(),
      edit: usePatchMessageMutation(),
      remove: useDeleteMessageMutation(),
      addReaction: useAddReactionMutation(),
      removeReaction: useRemoveReactionMutation(),
    };
    return null;
  }
  render(() => (
    <QueryClientProvider client={testQueryClient}>
      <Probe />
    </QueryClientProvider>
  ));
  return writes;
}

const sendTo = (parent: MessageParent, extra: object = {}) => ({
  parent,
  optimisticId: 'm1',
  senderId: SENDER,
  message: { content: 'hello' },
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.host = { name: 'host' };
  mocks.restReaders.clear();
  for (const write of Object.values(mocks.device))
    write.mockResolvedValue(message(CHANNEL, 'm1'));
  for (const write of Object.values(mocks.rest))
    write.mockResolvedValue(message(DOCUMENT, 'm1'));
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
  testQueryClient.clear();
});

describe('a write the device takes', () => {
  it('makes every write without a TanStack mutation or a REST request', async () => {
    const writes = mountWrites();
    const cacheChanged = vi.fn();
    const stop = [
      testQueryClient.getMutationCache().subscribe(cacheChanged),
      testQueryClient.getQueryCache().subscribe(cacheChanged),
    ];
    const onOptimisticInsert = vi.fn();

    await writes.send.mutateAsync(sendTo(CHANNEL, { onOptimisticInsert }));
    await writes.edit.mutateAsync({
      parent: CHANNEL,
      messageID: 'm1',
      content: 'edited',
      mentions: [],
    });
    const reaction = {
      parent: CHANNEL,
      messageId: 'm1',
      emoji: '👍',
      userId: SENDER,
    };
    await writes.addReaction.mutateAsync({ ...reaction, currentReactions: [] });
    await writes.removeReaction.mutateAsync(reaction);
    await writes.remove.mutateAsync({ parent: CHANNEL, messageID: 'm1' });
    for (const unsubscribe of stop) unsubscribe();

    expect(mocks.device.send).toHaveBeenCalledWith({
      channelId: CHANNEL.id,
      id: 'm1',
      senderId: SENDER,
      message: { content: 'hello' },
    });
    expect(mocks.device.edit).toHaveBeenCalledWith({
      channelId: CHANNEL.id,
      id: 'm1',
      content: 'edited',
      mentions: [],
      removeAttachmentIds: [],
      addAttachments: [],
    });
    expect(mocks.device.react.mock.calls).toEqual([
      [
        {
          channelId: CHANNEL.id,
          id: 'm1',
          emoji: '👍',
          add: true,
          userId: SENDER,
          reactions: [{ emoji: '👍', users: [SENDER] }],
        },
      ],
      [
        {
          channelId: CHANNEL.id,
          id: 'm1',
          emoji: '👍',
          add: false,
          userId: SENDER,
          reactions: undefined,
        },
      ],
    ]);
    expect(mocks.device.remove).toHaveBeenCalledWith({
      channelId: CHANNEL.id,
      id: 'm1',
    });
    expect(cacheChanged).not.toHaveBeenCalled();
    for (const request of Object.values(mocks.rest))
      expect(request).not.toHaveBeenCalled();
    expect(onOptimisticInsert).toHaveBeenCalledTimes(1);
    expect(mocks.track).toHaveBeenCalledWith(
      'channel_message_sent',
      expect.objectContaining({ isThreadReply: false })
    );
    expect(mocks.refetchSoup).toHaveBeenCalledWith(CHANNEL.id, 'channel');
  });

  it('tells the composer as the message shows, before the server has it', () => {
    mocks.device.send.mockReturnValue(new Promise(() => {}));
    const onOptimisticInsert = vi.fn();
    mountWrites().send.mutate(sendTo(CHANNEL, { onOptimisticInsert }));
    expect(onOptimisticInsert).toHaveBeenCalledTimes(1);
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it('says a failed write failed once, and hands it only to who awaits it', async () => {
    const refused = new Error('refused');
    mocks.device.send.mockRejectedValue(refused);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const writes = mountWrites();

    await expect(writes.send.mutateAsync(sendTo(CHANNEL))).rejects.toBe(
      refused
    );
    expect(mocks.rollback).toHaveBeenCalledTimes(1);
    expect(toast.failure).toHaveBeenCalledExactlyOnceWith(
      'Failed to send message'
    );
    expect(mocks.track).not.toHaveBeenCalled();

    vi.mocked(toast.failure).mockClear();
    mocks.device.remove.mockRejectedValue(refused);
    writes.remove.mutate({ parent: CHANNEL, messageID: 'm1' });
    await vi.waitFor(() =>
      expect(toast.failure).toHaveBeenCalledExactlyOnceWith(
        'Failed to delete message'
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('sends however the work beside it ends', async () => {
    const sent = Promise.withResolvers<ReturnType<typeof message>>();
    mocks.device.send.mockReturnValue(sent.promise);
    mocks.track.mockImplementationOnce(() => {
      throw new Error('no analytics');
    });
    const sending = mountWrites().send.mutateAsync(
      sendTo(CHANNEL, {
        onOptimisticInsert: () => {
          throw new Error('the composer is gone');
        },
      })
    );
    const confirmed = message(CHANNEL, 'm1');
    sent.resolve(confirmed);
    await expect(sending).resolves.toBe(confirmed);
    expect(toast.failure).not.toHaveBeenCalled();
  });

  it('is handed over with no connection, which only its queue waits for', async () => {
    onlineManager.setOnline(false);
    await mountWrites().send.mutateAsync(sendTo(CHANNEL));
    expect(mocks.device.send).toHaveBeenCalledTimes(1);
  });
});

describe('a write the device does not take', () => {
  it.each([
    ['of a document', DOCUMENT],
    ['of a channel read over REST', { type: 'channel', id: 'rest-channel' }],
  ] as const)(
    '%s waits for a connection as TanStack does',
    async (_, parent) => {
      mocks.restReaders.add('rest-channel');
      onlineManager.setOnline(false);
      const writes = mountWrites();
      const sending = writes.send.mutateAsync(sendTo(parent));
      const [mutation] = testQueryClient.getMutationCache().getAll();
      await vi.waitFor(() => expect(mutation?.state.isPaused).toBe(true));
      // No mode of its own: the app's default decides.
      expect(mutation?.options.networkMode).toBeUndefined();
      expect(mocks.rest.post).not.toHaveBeenCalled();
      expect(mocks.device.send).not.toHaveBeenCalled();

      onlineManager.setOnline(true);
      await testQueryClient.resumePausedMutations();
      await sending;
      expect(mocks.rest.post).toHaveBeenCalledTimes(1);
    }
  );

  it('sends an anchored message over REST, which the device has no place for', async () => {
    await mountWrites().send.mutateAsync(
      sendTo(CHANNEL, { message: { content: 'hello', anchor: {} } })
    );
    expect(mocks.rest.post).toHaveBeenCalledTimes(1);
    expect(mocks.device.send).not.toHaveBeenCalled();
  });

  it('picks the path for each write, not once per hook', async () => {
    const writes = mountWrites();
    await writes.send.mutateAsync(sendTo(CHANNEL));
    mocks.host = undefined;
    await writes.send.mutateAsync(sendTo(CHANNEL));
    expect(mocks.device.send).toHaveBeenCalledTimes(1);
    expect(mocks.rest.post).toHaveBeenCalledTimes(1);
  });
});

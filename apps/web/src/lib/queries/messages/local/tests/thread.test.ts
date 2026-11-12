import {
  CHANNEL_TIMELINE_HEAD,
  CHANNEL_TIMELINE_START,
} from '@graphql-cache/index';
import { describe, expect, it, vi } from 'vitest';
import {
  type ChannelThreadServerPage,
  loadChannelMessage,
  loadChannelThread,
} from '../thread';
import {
  CHANNEL_ID,
  devicePage,
  fakeHost,
  graphqlMessage,
  keyOf,
} from './fixtures';

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: vi.fn(),
}));

const root = graphqlMessage(1);
const replies = [2, 3, 4].map((n) => graphqlMessage(n, { threadId: root.id }));

const threadPage = (
  overrides: Partial<ChannelThreadServerPage>
): ChannelThreadServerPage => ({
  root,
  replies: [],
  olderCursor: null,
  newerCursor: null,
  seq: '9',
  ...overrides,
});

describe('loadChannelThread', () => {
  it('reads a held thread from the device, oldest reply first', async () => {
    const host = fakeHost(
      [
        devicePage([keyOf(replies[2])], { olderCursor: replies[2].sortKey }),
        devicePage([keyOf(replies[1]), keyOf(replies[0])]),
      ],
      { records: [root, ...replies] }
    );
    const fetchPage = vi.fn();

    const loaded = await loadChannelThread(
      host,
      CHANNEL_ID,
      root.id,
      fetchPage
    );

    expect(fetchPage).not.toHaveBeenCalled();
    expect(host.reads[1]).toMatchObject({
      threadRootId: root.id,
      before: replies[2].sortKey,
    });
    expect(loaded?.source).toBe('device');
    expect(loaded?.thread.root.id).toBe(root.id);
    expect(loaded?.thread.state.root_id).toBe(root.id);
    expect(loaded?.thread.replies.map((reply) => reply.id)).toEqual(
      replies.map((reply) => reply.id)
    );
  });

  it('fetches every page of a thread the device does not hold', async () => {
    const host = fakeHost([devicePage([], { covered: false })]);
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(
        threadPage({
          replies: [replies[1], replies[2]],
          olderCursor: replies[1].sortKey,
          seq: '9',
        })
      )
      .mockResolvedValueOnce(threadPage({ replies: [replies[0]], seq: '8' }));

    const loaded = await loadChannelThread(
      host,
      CHANNEL_ID,
      root.id,
      fetchPage
    );

    expect(fetchPage.mock.calls[1][0]).toMatchObject({
      rootId: root.id,
      before: replies[1].sortKey,
    });
    expect(loaded?.source).toBe('server');
    expect(loaded?.thread.replies.map((reply) => reply.id)).toEqual(
      replies.map((reply) => reply.id)
    );
    expect(host.commits).toEqual([
      {
        channelId: CHANNEL_ID,
        coverage: [
          {
            threadRootId: root.id,
            start: CHANNEL_TIMELINE_START,
            end: CHANNEL_TIMELINE_HEAD,
          },
        ],
        seq: { kind: 'lower', seq: '8' },
      },
    ]);
  });

  it('leaves channels to REST on an engine without channel timelines', async () => {
    const host = fakeHost([{ kind: 'unsupported' }]);
    expect(
      await loadChannelThread(host, CHANNEL_ID, root.id, vi.fn())
    ).toBeUndefined();
  });
});

describe('loadChannelMessage', () => {
  it('resolves a held message without a request', async () => {
    const host = fakeHost([], { records: [replies[0]] });
    const fetchMessage = vi.fn();
    expect(
      await loadChannelMessage(host, CHANNEL_ID, replies[0].id, fetchMessage)
    ).toBe(replies[0]);
    expect(fetchMessage).not.toHaveBeenCalled();
  });

  it('asks the server for a message the device does not hold', async () => {
    const host = fakeHost([]);
    const fetchMessage = vi.fn(async () => root);
    expect(
      await loadChannelMessage(host, CHANNEL_ID, root.id, fetchMessage)
    ).toBe(root);
    expect(fetchMessage).toHaveBeenCalledWith(CHANNEL_ID, root.id);
  });
});

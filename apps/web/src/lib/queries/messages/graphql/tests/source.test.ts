import type { CacheHost } from '@graphql-cache/host/types';
import {
  INITIAL_CACHE_REVISION,
  MAX_RECORD_SELECTION_PAGE_SIZE,
} from '@graphql-cache/protocol';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: vi.fn(),
  getUncachedGraphqlSoupClient: vi.fn(),
}));

import {
  type LatestChannelPage,
  latestPageRecordKeys,
  readCachedPageRecords,
  writeCachedLatestPage,
} from '../source';
import { activity, CHANNEL, messageEntry, page, reply, root } from './fixtures';

type StoredTimeline = { entries: unknown[] };
type PageHost = Pick<
  CacheHost,
  'writeQuery' | 'readRecordsByKeys' | 'deleteRecords'
>;

/**
 * A cache that keeps each channel's written page and answers the page-rows
 * fragment from it, as the engine projects the record that holds the page.
 */
function pageHost() {
  const pages = new Map<string, StoredTimeline>();
  const host = {
    writeQuery: vi.fn<PageHost['writeQuery']>(async (args) => {
      const data = args.data as {
        user: { channelMessages: { id: string; timeline: StoredTimeline } };
      };
      const { id, timeline } = data.user.channelMessages;
      pages.set(`GraphqlChannelMessages:${id}`, timeline);
      return { affected: [] } as unknown as Awaited<
        ReturnType<PageHost['writeQuery']>
      >;
    }),
    readRecordsByKeys: vi.fn<PageHost['readRecordsByKeys']>(async (args) => ({
      revision: INITIAL_CACHE_REVISION,
      records: args.keys.flatMap((recordKey) => {
        const timeline = pages.get(recordKey);
        if (!timeline) return [];
        const id = recordKey.slice('GraphqlChannelMessages:'.length);
        return [{ recordKey, record: { id, timeline } }];
      }),
    })),
    deleteRecords: vi.fn<PageHost['deleteRecords']>(
      async () =>
        ({ affected: [] }) as unknown as Awaited<
          ReturnType<PageHost['deleteRecords']>
        >
    ),
  } satisfies PageHost;
  return host;
}

function latest(...entries: LatestChannelPage['page']['entries']) {
  return { seq: 1, userId: 'user', page: page(entries) };
}

const WITH_PREVIEW = messageEntry('m1', 1, {
  thread: {
    reply_count: 1,
    latest_reply_at: null,
    preview: [reply('r1', 'm1', 2)],
  },
});

describe('the records of a cached page', () => {
  it('names the page record, its rows, preview replies and activities', () => {
    expect(
      latestPageRecordKeys(
        CHANNEL.id,
        page([WITH_PREVIEW, { type: 'activity', activity: activity('a1', 3) }])
      )
    ).toEqual([
      'GraphqlChannelMessages:channel-1',
      'GraphqlChannelMessage:m1',
      'GraphqlChannelMessage:r1',
      'GraphqlChannelTimelineActivity:a1',
    ]);
  });

  it('reads the stored rows of channels that have a page, in bounded batches', async () => {
    const host = pageHost();
    await writeCachedLatestPage(host, CHANNEL.id, latest(WITH_PREVIEW));
    const channelIds = [
      ...Array.from(
        { length: MAX_RECORD_SELECTION_PAGE_SIZE },
        (_, index) => `empty-${index}`
      ),
      CHANNEL.id,
    ];
    host.readRecordsByKeys.mockClear();
    const pages = await readCachedPageRecords(host, channelIds);
    expect(host.readRecordsByKeys).toHaveBeenCalledTimes(2);
    for (const [args] of host.readRecordsByKeys.mock.calls) {
      expect(args.keys.length).toBeLessThanOrEqual(
        MAX_RECORD_SELECTION_PAGE_SIZE
      );
    }
    expect([...pages]).toEqual([
      [
        CHANNEL.id,
        [
          'GraphqlChannelMessages:channel-1',
          'GraphqlChannelMessage:m1',
          'GraphqlChannelMessage:r1',
        ],
      ],
    ]);
  });
});

describe('writing a cached page', () => {
  it('deletes the rows the old page held and the new one does not', async () => {
    const host = pageHost();
    await writeCachedLatestPage(
      host,
      CHANNEL.id,
      latest(WITH_PREVIEW, messageEntry('m2', 0), {
        type: 'activity',
        activity: activity('a1', 0),
      })
    );
    expect(host.deleteRecords).not.toHaveBeenCalled();

    await writeCachedLatestPage(
      host,
      CHANNEL.id,
      latest(messageEntry('m3', 4), { type: 'message', message: root('m1', 1) })
    );
    expect(host.deleteRecords).toHaveBeenCalledOnce();
    expect(host.deleteRecords).toHaveBeenCalledWith([
      'GraphqlChannelMessage:r1',
      'GraphqlChannelMessage:m2',
      'GraphqlChannelTimelineActivity:a1',
    ]);
  });

  it('lets a write finish before the next one reads what the page holds', async () => {
    const host = pageHost();
    await writeCachedLatestPage(
      host,
      CHANNEL.id,
      latest(messageEntry('m2', 2), messageEntry('m1', 1))
    );
    // The first drops m2; the second, started before it finished, shows m2.
    await Promise.all([
      writeCachedLatestPage(host, CHANNEL.id, latest(messageEntry('m1', 1))),
      writeCachedLatestPage(
        host,
        CHANNEL.id,
        latest(messageEntry('m2', 2), messageEntry('m1', 1))
      ),
    ]);
    expect(host.deleteRecords).toHaveBeenCalledExactlyOnceWith([
      'GraphqlChannelMessage:m2',
    ]);
    const lastWrite = host.writeQuery.mock.invocationCallOrder.at(-1) ?? 0;
    expect(host.deleteRecords.mock.invocationCallOrder[0]).toBeLessThan(
      lastWrite
    );
  });

  it('deletes nothing when the new page keeps every row', async () => {
    const host = pageHost();
    await writeCachedLatestPage(host, CHANNEL.id, latest(WITH_PREVIEW));
    await writeCachedLatestPage(
      host,
      CHANNEL.id,
      latest(messageEntry('m2', 3), WITH_PREVIEW)
    );
    expect(host.deleteRecords).not.toHaveBeenCalled();
  });
});

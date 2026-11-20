import { INITIAL_CACHE_REVISION } from '@graphql-cache/index';
import { describe, expect, it } from 'vitest';
import { createChannelDirectoryIndex } from './directory-cache';
import { channelRecord, fakeChannelCache } from './tests/directory-fixtures';

describe('cached channel directory', () => {
  it('reads every cached channel across search pages and read batches', async () => {
    const cache = fakeChannelCache();
    for (let index = 0; index < 1_201; index += 1)
      cache.put(channelRecord(`c${index}`), { timestampMs: index });

    const read = await createChannelDirectoryIndex(cache.host).refresh('g1');

    expect(read.channels).toHaveLength(1_201);
    expect(new Set(read.channels.map(({ id }) => id)).size).toBe(1_201);
    expect(read).toMatchObject({ incomplete: 0, reread: 1_201 });
    expect(cache.host.search).toHaveBeenCalledTimes(3);
    expect(
      cache.host.readRecordsByKeys.mock.calls.map(([args]) => args.keys.length)
    ).toEqual([500, 500, 201]);
  });

  it('normalizes the record into the directory shape', async () => {
    const cache = fakeChannelCache();
    cache.put(
      channelRecord('dm', {
        channelType: 'DIRECT_MESSAGE',
        name: 'Ada',
        botParticipants: [
          {
            channelId: 'dm',
            botId: 'bot-1',
            role: 'MEMBER',
            joinedAt: '2026-11-02T00:00:00+00:00',
            leftAt: null,
          },
        ],
      })
    );

    const [channel] = (
      await createChannelDirectoryIndex(cache.host).refresh('g1')
    ).channels;

    expect(channel).toMatchObject({
      id: 'dm',
      name: 'Ada',
      channelType: 'direct_message',
      participants: [{ userId: 'macro|owner@example.com', role: 'owner' }],
      botParticipants: [{ botId: 'bot-1', role: 'member' }],
    });
  });

  it('rereads only records whose search document changed', async () => {
    const cache = fakeChannelCache();
    cache.put(channelRecord('a'));
    cache.put(channelRecord('b'));
    const index = createChannelDirectoryIndex(cache.host);
    const first = await index.refresh('g1');

    cache.put(channelRecord('b', { name: 'renamed' }), { sourceHash: 'b2' });
    cache.host.readRecordsByKeys.mockClear();
    const second = await index.refresh('g1');

    expect(second.reread).toBe(1);
    expect(cache.host.readRecordsByKeys.mock.calls[0]?.[0].keys).toEqual([
      'GraphqlSoupChannel:b',
    ]);
    const byId = (read: typeof first, id: string) =>
      read.channels.find((channel) => channel.id === id);
    expect(byId(second, 'a')).toBe(byId(first, 'a'));
    expect(byId(second, 'b')?.name).toBe('renamed');
  });

  it('counts records that lack a directory field and reads them once complete', async () => {
    const cache = fakeChannelCache();
    cache.put(channelRecord('partial'), { incomplete: true, sourceHash: 'p1' });
    const index = createChannelDirectoryIndex(cache.host);

    expect(await index.refresh('g1')).toMatchObject({
      channels: [],
      incomplete: 1,
    });

    cache.put(channelRecord('partial'), { sourceHash: 'p2' });
    const read = await index.refresh('g1');
    expect(read.incomplete).toBe(0);
    expect(read.channels.map(({ id }) => id)).toEqual(['partial']);
  });

  it('keeps a record the search pages skipped while it is still cached', async () => {
    const cache = fakeChannelCache();
    cache.put(channelRecord('moving'));
    cache.put(channelRecord('gone'));
    const index = createChannelDirectoryIndex(cache.host);
    await index.refresh('g1');

    // The search misses `moving` (its sort time changed mid-read) and `gone`
    // was deleted.
    const moving = cache.records.get('GraphqlSoupChannel:moving')!;
    cache.records.delete('GraphqlSoupChannel:moving');
    cache.records.delete('GraphqlSoupChannel:gone');
    cache.host.readRecordsByKeys.mockImplementationOnce(async () => ({
      revision: INITIAL_CACHE_REVISION,
      records: [
        { recordKey: 'GraphqlSoupChannel:moving', record: moving.record },
      ],
    }));
    const read = await index.refresh('g1');

    expect(read.channels.map(({ id }) => id)).toEqual(['moving']);

    // Listed again with its old hash, it is read again rather than trusted.
    cache.records.set('GraphqlSoupChannel:moving', moving);
    cache.host.readRecordsByKeys.mockClear();
    await index.refresh('g1');
    expect(cache.host.readRecordsByKeys.mock.calls[0]?.[0].keys).toEqual([
      'GraphqlSoupChannel:moving',
    ]);
  });

  it('starts over when the storage generation changes', async () => {
    const cache = fakeChannelCache();
    cache.put(channelRecord('a'));
    const index = createChannelDirectoryIndex(cache.host);
    await index.refresh('g1');

    expect((await index.refresh('g1')).reread).toBe(0);
    expect((await index.refresh('g2')).reread).toBe(1);
  });

  it('stops when aborted', async () => {
    const cache = fakeChannelCache();
    cache.put(channelRecord('a'));
    const controller = new AbortController();
    controller.abort();

    await expect(
      createChannelDirectoryIndex(cache.host).refresh('g1', controller.signal)
    ).rejects.toThrow();
  });
});

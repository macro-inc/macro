import { rankCommandSearchItems } from '@app/features/command/rank-command-search-items';
import {
  filterQuickAccessItems,
  searchQuickAccessItems,
} from '@core/context/quickAccess/entity-search';
import type { CacheHost, SearchDocumentWire } from '@graphql-cache/index';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/index';
import { describe, expect, it, vi } from 'vitest';
import { materializeCachedEmailItems } from './quick-access';

const hit: SearchDocumentWire = {
  profile: 'quick-access-v1',
  recordKey: 'GraphqlSoupEmailThread:thread',
  bucket: 'email',
  searchText:
    'weekly update | alex | alex@example.com | teo earlier | teo@sender.test',
  timestampMs: 100,
  sourceHash: 'hash',
};
const thread = {
  __typename: 'GraphqlSoupEmailThread',
  id: 'thread',
  name: 'Weekly update',
  ownerId: 'owner',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  viewedAt: null,
  senderName: 'Alex',
  senderEmail: 'alex@example.com',
  senders: [{ name: 'Teo Earlier', email: 'teo@sender.test' }],
  isRead: true,
  isDraft: false,
  isImportant: false,
  inboxVisible: true,
  linkId: 'inbox',
};

describe('cached email Quick Access', () => {
  it('materializes one thread and retains sender-only matches during frontend ranking and pending search', async () => {
    const read = vi.fn<CacheHost['readRecordsByKeys']>().mockResolvedValue({
      revision: INITIAL_CACHE_REVISION,
      records: [{ recordKey: hit.recordKey, record: thread }],
    });
    const items = await materializeCachedEmailItems(
      { readRecordsByKeys: read },
      [hit, hit]
    );
    expect(items).toHaveLength(1);
    expect(items[0].data.name).toBe('Weekly update');
    for (const query of ['t', 'te', 'teo', 'teo@sender.test', 'weekly']) {
      expect(filterQuickAccessItems(items, query)).toEqual(items);
      expect(searchQuickAccessItems(items, query)).toEqual(items);
      expect(
        rankCommandSearchItems(items, query, {
          preserveAdditionalEntityMatches: true,
        })
      ).toEqual(items);
    }
    expect(filterQuickAccessItems(items, 'quartz')).toEqual([]);
    expect(items[0].data).not.toHaveProperty('snippet');
  });
  it('reads fresh records and respects missing/inaccessible cached records', async () => {
    const read = vi
      .fn<CacheHost['readRecordsByKeys']>()
      .mockResolvedValueOnce({
        revision: INITIAL_CACHE_REVISION,
        records: [
          { recordKey: hit.recordKey, record: { ...thread, name: null } },
        ],
      })
      .mockResolvedValueOnce({
        revision: INITIAL_CACHE_REVISION,
        records: [
          { recordKey: hit.recordKey, record: { ...thread, name: 'Renamed' } },
        ],
      })
      .mockResolvedValueOnce({ revision: INITIAL_CACHE_REVISION, records: [] });
    expect(
      (await materializeCachedEmailItems({ readRecordsByKeys: read }, [hit]))[0]
        .data.name
    ).toBe('');
    expect(
      (await materializeCachedEmailItems({ readRecordsByKeys: read }, [hit]))[0]
        .data.name
    ).toBe('Renamed');
    expect(
      await materializeCachedEmailItems({ readRecordsByKeys: read }, [hit])
    ).toEqual([]);
  });
});

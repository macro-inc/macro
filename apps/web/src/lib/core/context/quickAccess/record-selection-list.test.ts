import type { EntityData } from '@entity';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createRecordSelectionQuickAccessItems } from './record-selection-list';
import type { EntityBucket, EntityItem, QuickAccessItem } from './types';

function entity(
  id: string,
  bucket: EntityBucket,
  searchText: string,
  sortTimestamp: number
): EntityItem {
  return {
    kind: 'entity',
    id,
    bucket,
    searchText,
    sortTimestamp,
    timestamps: {},
    data: {
      id,
      name: searchText,
      ownerId: 'user-1',
      type: bucket === 'email' ? 'email' : 'document',
    } as EntityData,
  };
}

function runInRoot(run: () => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    createRoot((dispose) => {
      void run().then(
        () => {
          dispose();
          resolve();
        },
        (error) => {
          dispose();
          reject(error);
        }
      );
    });
  });
}

describe('createRecordSelectionQuickAccessItems', () => {
  it('filters, sorts, searches, counts, and paginates locally', async () => {
    await runInRoot(async () => {
      const [searchTerm, setSearchTerm] = createSignal('');
      const selected = [
        entity('a', 'document', 'Alpha', 20),
        entity('b', 'email', 'Bravo', 30),
        entity('c', 'document', 'Charlie', 10),
        entity('snippet', 'snippet', 'Snippet', 40),
      ];
      const local: QuickAccessItem[] = [
        entity('a', 'document', 'Alpha local', 25),
        {
          kind: 'user',
          id: 'person',
          bucket: 'person',
          searchText: 'Taylor | taylor@example.com',
          sortTimestamp: 5,
          timestamps: {},
          data: {
            id: 'person',
            name: 'Taylor',
            email: 'taylor@example.com',
          },
        },
      ];
      const list = createRecordSelectionQuickAccessItems({
        buckets: [],
        searchTerm,
        enabled: () => true,
        pageSize: 2,
        selectedItems: () => selected,
        localItems: () => local,
        instructionsId: () => undefined,
        snippetsEnabled: () => false,
        crmEnabled: () => true,
        onItems: () => undefined,
      });

      expect(list.items().map((item) => item.id)).toEqual(['b', 'a']);
      expect(list.totalCount()).toBe(4);
      expect(list.hasMore()).toBe(true);
      await list.loadMore();
      expect(list.items().map((item) => item.id)).toEqual([
        'b',
        'a',
        'c',
        'person',
      ]);
      expect(list.hasMore()).toBe(false);

      setSearchTerm('charlie');
      await Promise.resolve();
      expect(list.items()[0]?.id).toBe('c');
      expect(list.totalCount()).toBe(2); // matching entity plus local user
      expect(list.hasMore()).toBe(false);
    });
  });

  it('applies bucket filtering before counts and visible slicing', async () => {
    await runInRoot(async () => {
      const list = createRecordSelectionQuickAccessItems({
        buckets: ['document'],
        searchTerm: () => '',
        enabled: () => true,
        pageSize: 1,
        selectedItems: () => [
          entity('doc-a', 'document', 'A', 1),
          entity('email-a', 'email', 'Email', 2),
          entity('doc-b', 'document', 'B', 3),
        ],
        localItems: () => [],
        instructionsId: () => undefined,
        snippetsEnabled: () => true,
        crmEnabled: () => true,
        onItems: () => undefined,
      });

      expect(list.items().map((item) => item.id)).toEqual(['doc-b']);
      expect(list.totalCount()).toBe(2);
      expect(list.hasMore()).toBe(true);
      await list.loadMore();
      expect(list.items().map((item) => item.id)).toEqual(['doc-b', 'doc-a']);
    });
  });
});

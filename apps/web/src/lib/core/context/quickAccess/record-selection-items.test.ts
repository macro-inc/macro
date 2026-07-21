import type { CacheHost } from '@graphql-cache/index';
import type { SoupItemFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { describe, expect, it, vi } from 'vitest';
import { readCachedQuickAccessRecords } from './record-selection-items';

const item = (id: string) => ({ id }) as SoupItemFieldsFragment;

describe('readCachedQuickAccessRecords', () => {
  it('loads every record page with exclusive cursors', async () => {
    const readRecords = vi
      .fn()
      .mockResolvedValueOnce({
        records: [item('a'), item('b')],
        nextCursor: 'cursor-b',
      })
      .mockResolvedValueOnce({ records: [item('c')], nextCursor: null });

    await expect(
      readCachedQuickAccessRecords({ readRecords } as Pick<
        CacheHost,
        'readRecords'
      >)
    ).resolves.toEqual([item('a'), item('b'), item('c')]);
    expect(readRecords).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        document: expect.stringContaining('fragment QuickAccessSoupItemFields'),
        fragmentName: 'QuickAccessSoupItemFields',
      })
    );
    expect(readRecords.mock.calls[0]?.[0].document).toContain(
      'GraphqlSoupEmailThread'
    );
    expect(readRecords.mock.calls[0]?.[0].document).toContain(
      'attachmentCount'
    );
    expect(readRecords.mock.calls[0]?.[0].document).toContain(
      'participantCount'
    );
    expect(readRecords).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: 'cursor-b', limit: 500 })
    );
  });

  it('rejects a repeated host cursor', async () => {
    const readRecords = vi.fn().mockResolvedValue({
      records: [],
      nextCursor: 'same-cursor',
    });
    await expect(
      readCachedQuickAccessRecords({ readRecords } as Pick<
        CacheHost,
        'readRecords'
      >)
    ).rejects.toThrow('repeated cursor');
  });
});

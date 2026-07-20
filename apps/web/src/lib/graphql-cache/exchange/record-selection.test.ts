import {
  SoupDocument,
  type SoupItemFieldsFragment,
  SoupItemFieldsFragmentDoc,
} from '@service-storage/graphql/generated/graphql';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { CacheHost } from '../host/types';
import { readRecords, selectRecords } from './record-selection';

describe('typed record selection', () => {
  it('extracts the root fragment and infers generated result types', async () => {
    const readRecordsHost = vi.fn().mockResolvedValue({
      records: [{ id: 'item-1' }],
      nextCursor: 'cursor-1',
    });
    const host = { readRecords: readRecordsHost } as unknown as CacheHost;
    const selection = selectRecords(SoupItemFieldsFragmentDoc);
    const page = await readRecords(host, selection, { limit: 25 });

    expect(readRecordsHost).toHaveBeenCalledWith({
      document: expect.stringContaining('fragment SoupItemFields'),
      fragmentName: 'SoupItemFields',
      cursor: undefined,
      limit: 25,
    });
    expect(page.nextCursor).toBe('cursor-1');
    expectTypeOf(page.records).toEqualTypeOf<SoupItemFieldsFragment[]>();
    // @ts-expect-error Generated fragment records have no arbitrary field.
    page.records[0]?.missing;
  });

  it('rejects operation documents and malformed host pages', async () => {
    expect(() => selectRecords(SoupDocument)).toThrow(
      'requires a fragment-only document'
    );

    const selection = selectRecords(SoupItemFieldsFragmentDoc);
    for (const result of [
      null,
      { records: null, nextCursor: null },
      { records: [null], nextCursor: null },
      { records: [], nextCursor: 42 },
    ]) {
      const host = {
        readRecords: async () => result,
      } as unknown as CacheHost;
      await expect(readRecords(host, selection, { limit: 1 })).rejects.toThrow(
        'invalid cache'
      );
    }
  });
});

import {
  SoupDocument,
  type SoupItemFieldsFragment,
  SoupItemFieldsFragmentDoc,
} from '@service-storage/graphql/generated/graphql';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { CacheHost } from '../host/types';
import { readRecordsByKeys, selectRecords } from './record-selection';

describe('typed record selection', () => {
  it('projects explicit keys and infers generated result types', async () => {
    const readRecordsByKeysHost = vi.fn().mockResolvedValue([
      {
        recordKey: 'GraphqlSoupDocument:item-1',
        record: { id: 'item-1' },
      },
    ]);
    const host = {
      readRecordsByKeys: readRecordsByKeysHost,
    } as unknown as CacheHost;
    const selection = selectRecords(SoupItemFieldsFragmentDoc);
    const records = await readRecordsByKeys(host, selection, [
      'GraphqlSoupDocument:item-1',
    ]);

    expect(readRecordsByKeysHost).toHaveBeenCalledWith({
      document: expect.stringContaining('fragment SoupItemFields'),
      fragmentName: 'SoupItemFields',
      keys: ['GraphqlSoupDocument:item-1'],
    });
    expectTypeOf(records).toEqualTypeOf<
      Array<{ recordKey: string; record: SoupItemFieldsFragment }>
    >();
    // @ts-expect-error Generated fragment records have no arbitrary field.
    records[0]?.record.missing;
  });

  it('rejects operation documents and malformed host records', async () => {
    expect(() => selectRecords(SoupDocument)).toThrow(
      'requires a fragment-only document'
    );

    const selection = selectRecords(SoupItemFieldsFragmentDoc);
    for (const result of [
      [{ recordKey: '', record: {} }],
      [{ recordKey: 'GraphqlSoupDocument:1', record: null }],
    ]) {
      const host = {
        readRecordsByKeys: async () => result,
      } as unknown as CacheHost;
      await expect(
        readRecordsByKeys(host, selection, ['GraphqlSoupDocument:1'])
      ).rejects.toThrow('invalid cache');
    }
  });
});

import { describe, expect, it } from 'vitest';
import type { SearchCacheArgs } from './protocol';
import {
  INITIAL_CACHE_REVISION,
  isCachePush,
  isCacheResponse,
  isWorkerMessage,
  MAX_RECORD_SELECTION_PAGE_SIZE,
  parseCacheRevision,
  validateCacheSearchArgs,
  validateRecordSelectionKeys,
} from './protocol';

describe('cache revisions', () => {
  it('accepts canonical Rust u64 decimal strings beyond JS safe integers', () => {
    expect(parseCacheRevision('9007199254740993')).toBe('9007199254740993');
    expect(parseCacheRevision('18446744073709551615')).toBe(
      '18446744073709551615'
    );
  });

  it.each(['', '-1', '+1', '01', '1.0', '18446744073709551616'])(
    'rejects malformed revision %s',
    (revision) => expect(() => parseCacheRevision(revision)).toThrow()
  );
});

describe('validateRecordSelectionKeys', () => {
  it('accepts bounded canonical entity keys, including an empty set', () => {
    expect(validateRecordSelectionKeys([])).toEqual([]);
    expect(validateRecordSelectionKeys(['GraphqlSoupDocument:one'])).toEqual([
      'GraphqlSoupDocument:one',
    ]);
  });

  it('rejects invalid or unbounded key sets', () => {
    expect(() => validateRecordSelectionKeys(['ROOT_QUERY'])).toThrow(
      'invalid normalized record key'
    );
    expect(() =>
      validateRecordSelectionKeys([`Thing:${'x'.repeat(1024)}`])
    ).toThrow('invalid normalized record key');
    expect(() =>
      validateRecordSelectionKeys(
        Array.from(
          { length: MAX_RECORD_SELECTION_PAGE_SIZE + 1 },
          (_, index) => `Thing:${index}`
        )
      )
    ).toThrow('accepts at most 500 keys');
  });
});

describe('validateCacheSearchArgs', () => {
  it('fills transport-neutral defaults and preserves deterministic clocks', () => {
    expect(
      validateCacheSearchArgs({
        profile: 'quick-access-v1',
        limit: 25,
        nowMs: 123,
      })
    ).toEqual({
      profile: 'quick-access-v1',
      buckets: [],
      query: '',
      limit: 25,
      nowMs: 123,
    });
  });

  it('rejects unbounded text, invalid buckets and page sizes', () => {
    expect(() =>
      validateCacheSearchArgs({
        profile: 'quick-access-v1',
        query: 'x'.repeat(513),
        limit: 25,
      })
    ).toThrow('query is too long');
    expect(() =>
      validateCacheSearchArgs({
        profile: 'quick-access-v1',
        query: 'é'.repeat(257),
        limit: 25,
      })
    ).toThrow('query is too long');
    expect(() =>
      validateCacheSearchArgs({
        profile: 'quick-access-v1',
        buckets: ['Document; DROP TABLE records'],
        limit: 25,
      })
    ).toThrow('invalid cache search bucket');
    expect(() =>
      validateCacheSearchArgs({ profile: 'quick-access-v1', limit: 501 })
    ).toThrow('cache search limit');
  });

  it('rejects invalid profiles, clocks and cursors at the public ingress', () => {
    expect(() =>
      validateCacheSearchArgs({
        profile: 'future-profile',
        limit: 25,
      } as unknown as SearchCacheArgs)
    ).toThrow('invalid cache search profile');
    expect(() =>
      validateCacheSearchArgs({
        profile: 'quick-access-v1',
        limit: 25,
        nowMs: -1,
      })
    ).toThrow('invalid cache search nowMs');
    expect(() =>
      validateCacheSearchArgs({
        profile: 'quick-access-v1',
        limit: 25,
        cursor: { timestampMs: 1.5, recordKey: 'Thing:one' },
      })
    ).toThrow('invalid cache search cursor');
    expect(() =>
      validateCacheSearchArgs({
        profile: 'quick-access-v1',
        limit: 25,
        cursor: { timestampMs: 1, recordKey: 'ROOT_QUERY' },
      })
    ).toThrow('invalid cache search cursor');
  });
});

describe('cache worker message validators', () => {
  it('accepts exact responses and every typed push', () => {
    const values = [
      { id: 1, ok: true, result: { kind: 'miss' } },
      { id: 2, ok: false, error: 'failed' },
      {
        id: 3,
        ok: false,
        error: 'old owner failed',
        errorCode: 'owner-epoch-lost',
      },
      {
        id: 4,
        ok: false,
        error: 'enqueue response uncertain',
        errorCode: 'admitted-enqueue-uncertain',
      },
      { kind: 'ops-affected', opIds: ['client:7'], keys: ['User:1'] },
      { kind: 'cache-changed', revision: INITIAL_CACHE_REVISION },
      {
        kind: 'mutation-settled',
        settlement: { transactionId: '3', status: 'committed' },
      },
      {
        kind: 'mutation-settled',
        settlement: {
          transactionId: '4',
          status: 'permanently-failed',
          error: 'denied',
        },
      },
    ];

    expect(values.map(isWorkerMessage)).toEqual(values.map(() => true));
    expect(isCacheResponse(values[0])).toBe(true);
    expect(isCachePush(values[4])).toBe(true);
  });

  it.each([
    null,
    [],
    'push',
    7,
    { id: -1, ok: true, result: null },
    { id: 1, ok: true },
    { id: 1, ok: false, error: 'failed', extra: true },
    { id: 1, ok: false, error: 'failed', errorCode: 'future-code' },
    { kind: 'ops-affected', opIds: [7], keys: [] },
    { kind: 'ops-affected', opIds: [], keys: [], extra: true },
    { kind: 'cache-changed', keys: [] },
    {
      kind: 'mutation-settled',
      settlement: { transactionId: '3', status: 'committed', error: 'extra' },
    },
    {
      kind: 'mutation-settled',
      settlement: { transactionId: '4', status: 'permanently-failed' },
    },
  ])('rejects malformed or extended worker message %#', (value) => {
    expect(isWorkerMessage(value)).toBe(false);
  });
});

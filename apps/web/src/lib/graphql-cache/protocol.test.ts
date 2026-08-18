import { describe, expect, it } from 'vitest';
import {
  isCachePush,
  isCacheResponse,
  isWorkerMessage,
  MAX_RECORD_SELECTION_PAGE_SIZE,
  validateRecordSelectionLimit,
} from './protocol';

describe('validateRecordSelectionLimit', () => {
  it('accepts bounded positive integers', () => {
    expect(validateRecordSelectionLimit(1)).toBe(1);
    expect(validateRecordSelectionLimit(MAX_RECORD_SELECTION_PAGE_SIZE)).toBe(
      MAX_RECORD_SELECTION_PAGE_SIZE
    );
  });

  it.each([
    0,
    -1,
    1.5,
    MAX_RECORD_SELECTION_PAGE_SIZE + 1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects invalid limit %s', (limit) => {
    expect(() => validateRecordSelectionLimit(limit)).toThrow(
      'record selection limit must be an integer between 1 and 500'
    );
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
      { kind: 'cache-changed' },
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

import { describe, expect, it } from 'vitest';
import { cachedRecord } from './cached-record';

type Harness = { id: string; access: 'owner' | 'viewer' };
const owned: Harness = { id: 'harness-1', access: 'owner' };
const isOne = (harness: Harness) => harness.id === 'harness-1';

describe('cachedRecord', () => {
  it('reads nothing while the first fetch is pending', () => {
    const pending = {
      isPending: true,
      get data(): Harness[] | undefined {
        throw new Error('reading data while pending suspends the screen');
      },
    };
    expect(cachedRecord(pending, isOne)).toBeUndefined();
  });

  it('keeps the cached record through a failed refetch', () => {
    // TanStack Query after a failed background refetch: an error, the last
    // data still there.
    const refetchFailed = {
      isPending: false,
      isSuccess: false,
      isError: true,
      data: [owned],
    };
    expect(cachedRecord(refetchFailed, isOne)).toBe(owned);
  });

  it('drops a record a successful refetch no longer has', () => {
    expect(cachedRecord({ isPending: false, data: [] }, isOne)).toBeUndefined();
  });
});

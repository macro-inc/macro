import { describe, expect, it, vi } from 'vitest';
import type {
  CacheRevision,
  EntityFilterCacheArgs,
  EntityFilterCacheResult,
} from '../../../graphql-cache/protocol';
import {
  MAX_MAIL_DEPTH_REQUESTS,
  type MailRequest,
  readMailDepth,
} from './mail-depth';

const R1 = 'r1' as CacheRevision;
const R2 = 'r2' as CacheRevision;
const request: MailRequest = {
  filters: {},
  sortMethod: 'UPDATED_AT',
  sortDirection: 'DESC',
  mail: { view: 'ALL' },
};

/** A Mail index of `total` threads, served `limit` at a time. */
function mailIndex(
  total: number,
  revisionAt?: (call: number) => CacheRevision
) {
  let calls = 0;
  const entityFilter = vi.fn(
    async (args: EntityFilterCacheArgs): Promise<EntityFilterCacheResult> => {
      calls += 1;
      const start = Number(args.mail?.cursor ?? 0);
      const end = Math.min(start + (args.limit ?? 20), total);
      const keys = Array.from(
        { length: end - start },
        (_, i) => `t${start + i}`
      );
      return {
        kind: 'mail-page',
        revision: revisionAt?.(calls) ?? R1,
        keys,
        sortTimestamps: keys.map(() => '2026-10-17T00:00:00Z'),
        nextCursor: end < total ? String(end) : null,
        optimistic: false,
      };
    }
  );
  return { entityFilter };
}

describe('readMailDepth', () => {
  it('reads past the per-request limit by following the cursor', async () => {
    const host = mailIndex(1200);

    const { result, requests } = await readMailDepth(host, request, 1000);

    expect(result.kind === 'mail-page' && result.keys).toHaveLength(1000);
    expect(requests).toBe(3);
    for (const [args] of host.entityFilter.mock.calls)
      expect(args.limit).toBeLessThan(500);
  });

  it('stops at the end of the index', async () => {
    const host = mailIndex(30);

    const { result, requests } = await readMailDepth(host, request, 100);

    expect(result.kind === 'mail-page' && result.keys).toHaveLength(30);
    expect(result.kind === 'mail-page' && result.nextCursor).toBeNull();
    expect(requests).toBe(1);
  });

  it('keeps the earlier revision when a write lands between requests', async () => {
    const host = mailIndex(1200, (call) => (call === 1 ? R1 : R2));

    const { result, requests } = await readMailDepth(host, request, 1000);

    expect(result.kind === 'mail-page' && result.revision).toBe(R1);
    expect(result.kind === 'mail-page' && result.keys).toHaveLength(499);
    expect(requests).toBe(2);
  });

  it('gives up after a bounded number of requests', async () => {
    const host = mailIndex(100_000);

    const { requests } = await readMailDepth(host, request, 100_000);

    expect(requests).toBe(MAX_MAIL_DEPTH_REQUESTS);
    expect(host.entityFilter).toHaveBeenCalledTimes(MAX_MAIL_DEPTH_REQUESTS);
  });

  it('ends on a page that repeats its cursor', async () => {
    const entityFilter = vi.fn(
      async (): Promise<EntityFilterCacheResult> => ({
        kind: 'mail-page',
        revision: R1,
        keys: ['t0'],
        sortTimestamps: ['2026-10-17T00:00:00Z'],
        nextCursor: 'same',
        optimistic: false,
      })
    );

    const { result, requests } = await readMailDepth(
      { entityFilter },
      request,
      50
    );

    expect(result.kind === 'mail-page' && result.keys).toEqual(['t0']);
    expect(requests).toBe(2);
  });
});

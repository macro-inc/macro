import { describe, expect, it } from 'vitest';
import { withinCacheHeadStart } from '../readiness';

describe('withinCacheHeadStart', () => {
  it('returns a read that settles within the head start', async () => {
    await expect(
      withinCacheHeadStart(Promise.resolve('cached'), 50)
    ).resolves.toBe('cached');
  });

  it('gives up on a read that outlasts the head start', async () => {
    await expect(
      withinCacheHeadStart(new Promise<string>(() => {}), 5)
    ).resolves.toBe('not-ready');
  });
});

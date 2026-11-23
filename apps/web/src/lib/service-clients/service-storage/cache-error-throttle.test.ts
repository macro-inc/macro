import { describe, expect, it } from 'vitest';
import { createCacheErrorThrottle } from './cache-error-throttle';

describe('createCacheErrorThrottle', () => {
  it('reports the first failure, then the count dropped in that minute', () => {
    let time = 0;
    const throttle = createCacheErrorThrottle(() => time);
    const error = new Error('cache worker timeout: read');

    expect(throttle.admit(error, 'query')).toEqual({
      report: true,
      suppressed: 0,
    });
    expect(throttle.admit(error, 'query').report).toBe(false);
    expect(throttle.admit(error, 'query').report).toBe(false);

    time = 60_000;
    expect(throttle.admit(error, 'query')).toEqual({
      report: true,
      suppressed: 2,
    });
  });

  it('treats failures that differ only by a number as one kind', () => {
    const throttle = createCacheErrorThrottle(() => 0);

    expect(
      throttle.admit(new Error('owner epoch 81 was lost'), 'query').report
    ).toBe(true);
    expect(
      throttle.admit(new Error('owner epoch 82 was lost'), 'query').report
    ).toBe(false);
  });

  it('keeps different failures and operation kinds separate', () => {
    const throttle = createCacheErrorThrottle(() => 0);
    const error = new Error('cache worker timeout: read');

    expect(throttle.admit(error, 'query').report).toBe(true);
    expect(throttle.admit(error, 'subscription').report).toBe(true);
    expect(throttle.admit(new Error('other'), 'query').report).toBe(true);
  });
});

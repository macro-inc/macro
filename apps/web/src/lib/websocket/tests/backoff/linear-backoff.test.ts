import { describe, expect, test } from 'vitest';
import { LinearBackoff } from '../../';

describe('Testsuite for LinearBackoff', () => {
  test('Initialization should throw on negative initial-backoff', () => {
    expect(() => new LinearBackoff(-1001, 1000)).toThrow();
    expect(() => new LinearBackoff(-42, 1000)).toThrow();
    expect(() => new LinearBackoff(-1, 1000)).toThrow();
  });

  test('Initialization should not throw on zero initial-backoff', () => {
    expect(() => new LinearBackoff(0, 1000)).not.toThrow();
  });

  test('Initialization should not throw on positive initial-backoff', () => {
    expect(() => new LinearBackoff(1, 1000)).not.toThrow();
    expect(() => new LinearBackoff(42, 1000)).not.toThrow();
    expect(() => new LinearBackoff(1001, 1000)).not.toThrow();
  });

  test('Initialization should throw on negative increment', () => {
    expect(() => new LinearBackoff(1000, -1001)).toThrow();
    expect(() => new LinearBackoff(1000, -42)).toThrow();
    expect(() => new LinearBackoff(1000, -1)).toThrow();
  });

  test('Initialization should not throw on zero increment', () => {
    expect(() => new LinearBackoff(1000, 0)).not.toThrow();
  });

  test('Initialization should not throw on positive increment', () => {
    expect(() => new LinearBackoff(1000, 1)).not.toThrow();
    expect(() => new LinearBackoff(1000, 42)).not.toThrow();
    expect(() => new LinearBackoff(1000, 1001)).not.toThrow();
  });

  test('Initialization should throw on negative max-backoff', () => {
    expect(() => new LinearBackoff(1000, 1000, -1001)).toThrow();
    expect(() => new LinearBackoff(1000, 1000, -42)).toThrow();
    expect(() => new LinearBackoff(1000, 1000, -1)).toThrow();
  });

  test('Initialization should not throw on undefined max-backoff', () => {
    expect(() => new LinearBackoff(1000, 1000, undefined)).not.toThrow();
  });

  test('Initialization should throw on max-backoff smaller than initial-backoff', () => {
    expect(() => new LinearBackoff(1000, 1000, 999)).toThrow();
    expect(() => new LinearBackoff(1000, 1000, 42)).toThrow();
    expect(() => new LinearBackoff(1000, 1000, 1)).toThrow();
  });

  test('Backoff should be equal to the given initial-backoff', () => {
    expect(new LinearBackoff(1, 1000).current).toBe(1);
    expect(new LinearBackoff(42, 1000).current).toBe(42);
    expect(new LinearBackoff(1001, 1000).current).toBe(1001);
  });

  test('Backoff should increment by the given increment with each next', () => {
    const backoff = new LinearBackoff(1000, 1000);
    for (let i = 0; i < 10; i++) {
      expect(backoff.current).toBe(1000 + i * 1000);
      expect(backoff.next()).toBe(1000 + (i + 1) * 1000);
      expect(backoff.current).toBe(1000 + (i + 1) * 1000);
    }
  });

  test('Backoff should increment with the given increment but not exceed the given max-backoff', () => {
    const backoff = new LinearBackoff(1000, 1000, 5000);
    for (let i = 0; i < 10; i++) {
      expect(backoff.current).toBe(Math.min(1000 + i * 1000, 5000));
      expect(backoff.next()).toBe(Math.min(1000 + (i + 1) * 1000, 5000));
      expect(backoff.current).toBe(Math.min(1000 + (i + 1) * 1000, 5000));
    }
  });

  test('Backoff should be equal to the given initial-backoff after reset', () => {
    const backoff = new LinearBackoff(42, 1000);
    backoff.next();
    backoff.reset();
    expect(backoff.current).toBe(42);
  });

  test('Retries should be zero after initialization', () => {
    expect(new LinearBackoff(1000, 1000).retries).toBe(0);
  });

  test('Retries should be incremented with each next', () => {
    const backoff = new LinearBackoff(1000, 1000);
    for (let i = 0; i < 10; i++) {
      expect(backoff.retries).toBe(i);
      backoff.next();
    }
  });

  test('Retries should be reset to zero after reset', () => {
    const backoff = new LinearBackoff(1000, 1000);
    for (let i = 0; i < 100; i++) {
      backoff.next();
    }
    backoff.reset();
    expect(backoff.retries).toBe(0);
  });
});

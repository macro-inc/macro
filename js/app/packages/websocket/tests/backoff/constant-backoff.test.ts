import { ConstantBackoff } from '../../';
import { describe, test, expect } from 'vitest';

describe('Testsuite for ConstantBackoff', () => {
  test('Initialization should throw on negative backoff', () => {
    expect(() => new ConstantBackoff(-1001)).toThrow();
    expect(() => new ConstantBackoff(-42)).toThrow();
    expect(() => new ConstantBackoff(-1)).toThrow();
  });

  test('Initialization should not throw on zero backoff', () => {
    expect(() => new ConstantBackoff(0)).not.toThrow();
  });

  test('Initialization should not throw on positive backoff', () => {
    expect(() => new ConstantBackoff(1)).not.toThrow();
    expect(() => new ConstantBackoff(42)).not.toThrow();
    expect(() => new ConstantBackoff(1001)).not.toThrow();
  });

  test('Backoff should be equal to the given backoff', () => {
    expect(new ConstantBackoff(1).current).toBe(1);
    expect(new ConstantBackoff(42).current).toBe(42);
    expect(new ConstantBackoff(1001).current).toBe(1001);
  });

  test('Backoff should be equal to the given backoff after next', () => {
    const backoff = new ConstantBackoff(42);
    expect(backoff.next()).toBe(42);
    expect(backoff.current).toBe(42);
  });

  test('Backoff should be equal to the given backoff after reset', () => {
    const backoff = new ConstantBackoff(42);
    expect(backoff.next()).toBe(42);
    backoff.reset();
    expect(backoff.current).toBe(42);
  });

  test('Retries should be zero after initialization', () => {
    expect(new ConstantBackoff(42).retries).toBe(0);
  });

  test('Retries should increment with each next', () => {
    const backoff = new ConstantBackoff(42);
    for (let i = 0; i < 100; i++) {
      expect(backoff.retries).toBe(i);
      backoff.next();
    }
  });

  test('Retries should be zero after reset', () => {
    const backoff = new ConstantBackoff(42);
    for (let i = 0; i < 100; i++) {
      backoff.next();
    }
    backoff.reset();
    expect(backoff.retries).toBe(0);
  });
});

import { expect, test } from 'vitest';
import { applyValueOrUpdater } from '../../compatibility-exceptions';
import { createState } from './config';

test('state configuration binds callbacks and computes an opaque default once', () => {
  const fallback = { value: 'default' };
  const supplied = { value: 'supplied' };
  let parses = 0;
  const options = {
    fallback,
    parse(value: unknown): { value: string } {
      parses++;
      return value === supplied ? supplied : this.fallback;
    },
    unparse(value: { value: string }): unknown {
      return value === this.fallback ? 'fallback' : value;
    },
    isEqual(first: { value: string }, second: { value: string }): boolean {
      return (
        first === second ||
        (first === this.fallback && second === this.fallback)
      );
    },
    resetOnCopyNode: true,
  };
  const config = createState('opaque', options);
  expect(parses).toBe(1);
  expect(config.defaultValue).toBe(fallback);
  expect(config.parse(supplied)).toBe(supplied);
  expect(config.unparse(fallback)).toBe('fallback');
  expect(config.unparse(supplied)).toBe(supplied);
  expect(config.isEqual(fallback, fallback)).toBe(true);
  expect(config.resetOnCopyNode).toBe(true);
  expect(parses).toBe(2);
  expect(Object.values(config).some((value) => value instanceof WeakMap)).toBe(
    false
  );
});

test('state updater adapter preserves upstream callable-value behavior and opaque returns', () => {
  const callable: () => number = () => 42;
  expect(applyValueOrUpdater<() => number>(callable, callable)).toBe(42);
  const opaque = { retained: true };
  expect(applyValueOrUpdater(opaque, { retained: false })).toBe(opaque);
  expect(applyValueOrUpdater(() => opaque, { retained: false })).toBe(opaque);
  const failure = {};
  try {
    applyValueOrUpdater(() => {
      throw failure;
    }, opaque);
    throw new Error('expected opaque updater error');
  } catch (error) {
    expect(error).toBe(failure);
  }
});

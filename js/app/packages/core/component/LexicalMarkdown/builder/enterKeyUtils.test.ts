import { describe, expect, test } from 'vitest';
import { shouldInsertNewlineOnEnter } from './enterKeyUtils';

describe('shouldInsertNewlineOnEnter', () => {
  test('returns true for shift+enter', () => {
    expect(
      shouldInsertNewlineOnEnter({
        shiftKey: true,
        metaKey: false,
        ctrlKey: false,
      })
    ).toBe(true);
  });

  test('returns false for enter', () => {
    expect(
      shouldInsertNewlineOnEnter({
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
      })
    ).toBe(false);
  });

  test('returns false for cmd+shift+enter', () => {
    expect(
      shouldInsertNewlineOnEnter({
        shiftKey: true,
        metaKey: true,
        ctrlKey: false,
      })
    ).toBe(false);
  });
});

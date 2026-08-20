import { describe, expect, test } from 'vitest';
import { isModEnter } from './modEnter';

describe('isModEnter', () => {
  test('accepts cmd+enter', () => {
    expect(
      isModEnter({ key: 'Enter', metaKey: true, ctrlKey: false })
    ).toBe(true);
  });

  test('accepts ctrl+enter', () => {
    expect(
      isModEnter({ key: 'Enter', metaKey: false, ctrlKey: true })
    ).toBe(true);
  });

  test('rejects a bare enter', () => {
    expect(
      isModEnter({ key: 'Enter', metaKey: false, ctrlKey: false })
    ).toBe(false);
  });

  test('rejects a modified non-enter key', () => {
    expect(isModEnter({ key: 'a', metaKey: true, ctrlKey: false })).toBe(false);
  });
});

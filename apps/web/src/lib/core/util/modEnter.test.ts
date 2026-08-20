import { describe, expect, test } from 'vitest';
import { isModEnter } from './modEnter';

const keyEvent = (
  key: string,
  modifiers: { metaKey?: boolean; ctrlKey?: boolean } = {}
) => ({ key, metaKey: false, ctrlKey: false, ...modifiers });

describe('isModEnter', () => {
  test('accepts cmd+enter', () => {
    expect(isModEnter(keyEvent('Enter', { metaKey: true }))).toBe(true);
  });

  test('accepts ctrl+enter', () => {
    expect(isModEnter(keyEvent('Enter', { ctrlKey: true }))).toBe(true);
  });

  test('rejects a bare enter', () => {
    expect(isModEnter(keyEvent('Enter'))).toBe(false);
  });

  test('rejects a modified non-enter key', () => {
    expect(isModEnter(keyEvent('a', { metaKey: true }))).toBe(false);
  });
});

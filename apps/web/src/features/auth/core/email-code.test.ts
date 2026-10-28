import { describe, expect, it } from 'vitest';
import { isCompleteCode, sessionTokenParam } from './email-code';

describe('sessionTokenParam', () => {
  it.each([
    [undefined, undefined],
    ['', undefined],
    ['abc', 'abc'],
    [['old', 'new'], 'new'],
    [[], undefined],
  ])('%o → %o', (value, expected) => {
    expect(sessionTokenParam(value)).toBe(expected);
  });
});

describe('isCompleteCode', () => {
  it('accepts exactly six digits', () => {
    expect(isCompleteCode('12345')).toBe(false);
    expect(isCompleteCode('123456')).toBe(true);
  });
});

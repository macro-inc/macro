import { expect, it } from 'vitest';
import { shouldUseUniversalInput } from './universal-input-mode';

it.each([
  ['investor update', false],
  ['email julia tomorrow', true],
  ['dinner with julia tomorrow at 9pm', true],
  ['a'.repeat(23), false],
  ['a'.repeat(24), true],
  ['  one  two\nthree  ', true],
  ['   investor update   ', false],
])('chooses the input mode for %s', (text, expected) => {
  expect(shouldUseUniversalInput(text)).toBe(expected);
});

it('keeps a shorter edited draft in composer mode until cleared', () => {
  expect(shouldUseUniversalInput('email julia', true)).toBe(true);
  expect(shouldUseUniversalInput(' \n ', true)).toBe(false);
});

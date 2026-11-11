import { expect, it } from 'vitest';
import { shouldUseUniversalInput } from './universal-input-mode';

it.each([
  ['investor update', false],
  ['email julia tomorrow', false],
  ['a b c d e f g h i j k l m n', false],
  ['dinner with julia tomorrow at 9pm', false],
  ['dinner with julia tomorrow at 9:30pm', true],
  ['a'.repeat(33), false],
  ['a'.repeat(34), true],
  [`  ${'a'.repeat(33)}  `, false],
  ['   investor update   ', false],
])('chooses the input mode for %s', (text, expected) => {
  expect(shouldUseUniversalInput(text)).toBe(expected);
});

it('keeps a shorter edited draft in composer mode until cleared', () => {
  expect(shouldUseUniversalInput('email julia', true)).toBe(true);
  expect(shouldUseUniversalInput(' \n ', true)).toBe(false);
});

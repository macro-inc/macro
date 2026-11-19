import { expect, test } from 'bun:test';
import { describeError, errorMessage } from '../error.ts';

test("an error's description always has its message, even when its stack lacks it", () => {
  const error = new Error('markdown: empty identity');
  // How a stack sometimes reads: the frames, without "Error: <message>".
  error.stack = 'Error\n    at writeIdentity (identity/index.ts:44:11)';
  const described = describeError(error);
  expect(described).toContain('markdown: empty identity');
  expect(described).toContain('at writeIdentity');
});

test('a stack that already starts with the message is kept as it is', () => {
  const error = new Error('markdown: empty identity');
  error.stack = 'Error: markdown: empty identity\n    at writeIdentity (x:1:1)';
  expect(describeError(error)).toBe(error.stack);
});

test('an error with no stack is its name and message, and anything else is its string', () => {
  const error = new TypeError('nope');
  error.stack = undefined;
  expect(describeError(error)).toBe('TypeError: nope');
  expect(describeError('plain')).toBe('plain');
  expect(errorMessage(error)).toBe('nope');
});

test('an error with an empty message is described by its name alone, never "Error: "', () => {
  const error = new Error('');
  error.stack = 'Error\n    at somewhere (x:1:1)';
  expect(describeError(error)).toBe(error.stack);
  error.stack = '    at somewhere (x:1:1)';
  expect(describeError(error)).toBe('Error\n    at somewhere (x:1:1)');
});

test('an error whose stack is not a string is described without throwing', () => {
  const error = new Error('boom');
  Object.defineProperty(error, 'stack', { value: 42 });
  expect(describeError(error)).toBe('Error: boom');
});

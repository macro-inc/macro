import { expect, test } from 'vitest';
import { privateFixtureNames } from '../privacy';

test('repository scanner excludes contact payloads and retains safe examples', () => {
  const phone = '+' + [1202, 555, 1234].join('');
  const files = new Map([
    ['safe.json', JSON.stringify({ args: ['test@example.com'] })],
    ['contact.json', JSON.stringify({ args: [phone] })],
  ]);
  expect(privateFixtureNames(files)).toEqual(['contact.json']);
});

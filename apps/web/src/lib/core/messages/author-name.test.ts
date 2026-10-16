import { expect, it } from 'vitest';
import { displayAuthorName } from './author-name';

it('removes only the generated test-phone suffix and preserves real names', () => {
  expect(displayAuthorName('+1 555-643-5162 (test number)')).toBe(
    '+1 555-643-5162'
  );
  expect(displayAuthorName('Jamie Chen')).toBe('Jamie Chen');
  expect(displayAuthorName('Studio (test number)')).toBe(
    'Studio (test number)'
  );
  expect(displayAuthorName('@cagarwal29')).toBe('@cagarwal29');
});

import { expect, it } from 'vitest';
import { usesCompactEmailRow } from './email-row-layout';

const narrowDesktopEmail = {
  wide: false,
  touch: false,
  narrowLayout: 'inbox',
  email: true,
} as const;

it('gives a narrow desktop Email list the compact row', () => {
  expect(usesCompactEmailRow(narrowDesktopEmail)).toBe(true);
});

it('keeps the touch email row, with the sender picture', () => {
  expect(usesCompactEmailRow({ ...narrowDesktopEmail, touch: true })).toBe(
    false
  );
});

it('leaves wide lists, other narrow layouts and other entities alone', () => {
  expect(usesCompactEmailRow({ ...narrowDesktopEmail, wide: true })).toBe(
    false
  );
  expect(
    usesCompactEmailRow({ ...narrowDesktopEmail, narrowLayout: 'standard' })
  ).toBe(false);
  expect(
    usesCompactEmailRow({ ...narrowDesktopEmail, narrowLayout: undefined })
  ).toBe(false);
  expect(usesCompactEmailRow({ ...narrowDesktopEmail, email: false })).toBe(
    false
  );
});

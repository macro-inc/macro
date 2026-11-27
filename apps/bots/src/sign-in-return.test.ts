import { expect, test } from 'bun:test';
import { signInReturn } from './sign-in-return';

const handoff = '20cf0d73-e1d5-4d28-82c9-3689e2359137';

test('sign-in returns only to an allowlisted route or exact Hire draft', () => {
  for (const path of ['/', '/fleet', '/passwords', '/billing']) {
    expect(signInReturn(new URLSearchParams({ return: path }).toString())).toBe(
      path
    );
  }
  const query = new URLSearchParams({ return: '/?intent=hire', handoff });
  expect(signInReturn(query.toString())).toBe(
    `/?intent=hire&handoff=${handoff}`
  );
});

test('sign-in refuses external, normalized, duplicate and mismatched return inputs', () => {
  for (const path of [
    '//elsewhere.localhost/fleet',
    '/view/../passwords',
    '/billing?tab=card',
    '/fleet#agent',
    'https://elsewhere.localhost',
  ]) {
    expect(signInReturn(new URLSearchParams({ return: path }).toString())).toBe(
      '/'
    );
  }
  expect(signInReturn('return=%2Ffleet&return=%2Fpasswords')).toBe('/');
  expect(signInReturn(`return=%2Fbilling&handoff=${handoff}`)).toBe('/');
  expect(signInReturn('return=%2F%3Fintent%3Dhire')).toBe('/');
});

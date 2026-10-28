import { expect, it } from 'vitest';
import { calendarCallNavigation } from './calendar-calls';

it('preserves a different environment host when joining a calendar invitation', () => {
  expect(
    calendarCallNavigation(
      'https://macro.com/app/meet/secret',
      'https://dev.macro.com'
    )
  ).toEqual({ kind: 'external', url: 'https://macro.com/app/meet/secret' });
  expect(
    calendarCallNavigation(
      'https://dev.macro.com/app/meet/secret?join=true',
      'https://dev.macro.com'
    )
  ).toEqual({ kind: 'internal', path: '/meet/secret?join=true' });
  expect(
    calendarCallNavigation('/meet/secret', 'http://localhost:3005')
  ).toEqual({ kind: 'internal', path: '/meet/secret' });
});

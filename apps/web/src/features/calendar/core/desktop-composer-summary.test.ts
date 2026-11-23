import { expect, it } from 'vitest';
import {
  desktopGuestLabel,
  desktopReminderLabel,
} from '../utils/desktop-composer-labels';
import {
  desktopDateSummary,
  desktopSummaryDetails,
} from './desktop-composer-summary';

it('joins date and time with commas for single and multi-day events', () => {
  expect(
    desktopDateSummary(
      '2030-11-13T13:00',
      '2030-11-13T14:30',
      false,
      '12-hour',
      'en-US'
    )
  ).toMatch(/Nov 13, /);
  expect(
    desktopDateSummary(
      '2030-11-13T13:00',
      '2030-11-14T14:30',
      false,
      '12-hour',
      'en-US'
    )
  ).toMatch(/Nov 13, .*Nov 14, /);
  expect(
    desktopDateSummary('2030-11-13', '2030-11-14', true, '12-hour', 'en-US')
  ).not.toContain(' @ ');
});

it('joins summary details without empty parts and counts guests', () => {
  expect(desktopSummaryDetails('PST', undefined, 'weekly')).toBe('PST, weekly');
  expect(desktopGuestLabel(0)).toBe('Add guests');
  expect(desktopGuestLabel(4)).toBe('4 guests');
});

it('uses short reminder offsets in the calendar summary', () => {
  expect(desktopReminderLabel([0, 10, 60])).toBe(
    'At start, 10 min before, 1 hour before'
  );
});

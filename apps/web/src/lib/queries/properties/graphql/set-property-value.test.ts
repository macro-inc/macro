import { expect, it } from 'vitest';
import { toGraphqlSetPropertyValue } from './entity';

it('sends a date with its time of day as dateWithTime and a whole day as date', () => {
  expect(
    toGraphqlSetPropertyValue({
      type: 'date',
      value: '2026-11-26T19:00:00.000Z',
      has_time: true,
    })
  ).toEqual({ dateWithTime: '2026-11-26T19:00:00.000Z' });
  expect(
    toGraphqlSetPropertyValue({
      type: 'date',
      value: '2026-11-26T05:00:00.000Z',
    })
  ).toEqual({ date: '2026-11-26T05:00:00.000Z' });
});

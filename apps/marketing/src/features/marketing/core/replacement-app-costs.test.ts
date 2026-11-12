import { expect, it } from 'vitest';
import { additionalAppCosts } from './replacement-app-costs';

it('charges once for bundled apps and includes independent subscriptions', () => {
  expect(
    additionalAppCosts(['Word', 'Excel', 'Outlook', 'Teams', 'Airtable'])
  ).toEqual([
    { selected: true, monthlyCents: 3200 },
    { selected: true, monthlyCents: 4500 },
  ]);
});
it('does not charge for deselected apps and keeps free apps free', () => {
  expect(additionalAppCosts([])).toEqual([]);
  expect(additionalAppCosts(['Discord'])).toEqual([
    { selected: true, monthlyCents: 0 },
  ]);
});

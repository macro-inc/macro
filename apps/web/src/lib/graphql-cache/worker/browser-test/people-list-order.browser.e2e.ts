import { expect, test } from '@playwright/test';

const ORDER = [['teammates'], ['interacted', 'invited'], ['gmail', 'outlook']];

test('orders a mention window by contact list through the real host and engine', async ({
  page,
}) => {
  await page.goto('/people-list-order.html');
  const result = page.locator('#result');
  await expect(result).toHaveAttribute('data-status', /passed|failed/);
  expect(
    await result.getAttribute('data-status'),
    (await result.textContent()) ?? 'No result'
  ).toBe('passed');
  const { browse, typed, unordered, sent } = JSON.parse(
    (await result.textContent()) ?? '{}'
  );
  // Teammates, then interacted or invited, then inbox contacts, then people
  // in none of the groups. A person in two lists takes the better group.
  expect(browse.slice(0, 5)).toEqual([
    'Sam 902',
    'Sam 904',
    'Sam 901',
    'Sam 903',
    'Sam 900',
  ]);
  // A whole-name match in no list still leads every word-start match.
  expect(typed.slice(0, 6)).toEqual([
    'Sam 90',
    'Sam 902',
    'Sam 904',
    'Sam 901',
    'Sam 903',
    'Sam 900',
  ]);
  expect(unordered.slice(0, 5)).not.toEqual(browse.slice(0, 5));
  // The engine reads policy 7. Its first search went without the order and
  // was sent again with it; later ones carry it, and a window without an
  // order sends none.
  expect(sent).toEqual([null, ORDER, ORDER, null]);
});

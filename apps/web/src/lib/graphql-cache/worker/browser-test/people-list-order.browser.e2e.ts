import { expect, test } from '@playwright/test';

const ORDER = [['interacted', 'invited'], ['teammates'], ['gmail', 'outlook']];

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
  // Interacted or invited, then teammates, then inbox contacts, then people
  // in none of the groups. A person in two lists takes the better group.
  expect(browse.slice(0, 5)).toEqual([
    'Sam 901',
    'Sam 903',
    'Sam 902',
    'Sam 904',
    'Sam 900',
  ]);
  // Among the people the text names the group decides first: a whole-name
  // match in no list follows every listed word-start match, and leads the
  // other people in none.
  expect(typed.slice(0, 7)).toEqual([
    'Sam 901',
    'Sam 903',
    'Sam 902',
    'Sam 904',
    'Sam 900',
    'Sam 90',
    'Sam 905',
  ]);
  expect(unordered.slice(0, 5)).not.toEqual(browse.slice(0, 5));
  // The engine reads policy 8. Its first search went without the order and
  // was sent again with it; later ones carry it, and a window without an
  // order sends none.
  expect(sent).toEqual([null, ORDER, ORDER, null]);
});

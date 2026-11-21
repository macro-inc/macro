import { expect, test } from '@playwright/test';

test('lists teammates as a tab without the cache does, with and without a list order', async ({
  page,
}) => {
  await page.goto('/people-teammate-order.html');
  const result = page.locator('#result');
  await expect(result).toHaveAttribute('data-status', /passed|failed/);
  expect(
    await result.getAttribute('data-status'),
    (await result.textContent()) ?? 'No result'
  ).toBe('passed');
  const { withoutLists, withLists, cacheless, sent } = JSON.parse(
    (await result.textContent()) ?? '{}'
  );
  // The direct-message partner, then teammates never messaged (exact before
  // word-start), then everyone else, so a teammate leads strangers whose
  // whole name is the query; contains-only matches last.
  const approved = [
    'jacoby.chat@example.com',
    'jacob.rivers@example.com',
    'jacobson.mate@example.com',
    'jacob.a@example.com',
    'jacob.b@example.com',
    'jacobi.stranger@example.com',
    'bjacob@example.com',
  ];
  expect(cacheless).toEqual(approved);
  expect(withoutLists).toEqual(approved);
  expect(withLists).toEqual(approved);
  // The engine reads policy 8: its first search went without the newer
  // fields and was sent again with the roster; later ones carry it.
  expect(sent).toEqual([
    { teammates: false, lists: false },
    { teammates: true, lists: false },
    { teammates: true, lists: true },
  ]);
});

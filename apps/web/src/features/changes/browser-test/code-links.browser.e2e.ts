import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.context().route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost') await route.continue();
    else await route.fulfill({ status: 404, body: '' });
  });
  await page.goto('/src/features/changes/browser-test/code-links.html');
  await expect(page.getByRole('region', { name: 'Agent session' })).toBeVisible(
    { timeout: 60_000 }
  );
});

test('inline code naming a changed file opens it in Changes at its line', async ({
  page,
}) => {
  const changes = page.getByRole('region', { name: 'Changes' });
  await expect(changes).toBeHidden();

  // `b` stays code; the path beside it became a link.
  await expect(page.getByRole('link', { name: 'b', exact: true })).toHaveCount(
    0
  );
  await page.getByRole('link', { name: 'apps/web/src/a.ts:2' }).click();

  await expect(changes).toBeVisible();
  // Pierre marks a selected line's gutter cell and its content cell.
  const selected = changes.locator(
    '[data-selected-line]:not([data-column-number])'
  );
  await expect(selected).toHaveCount(1);
  await expect(selected).toContainText('const b = 3;');
  await expect(selected).toBeInViewport();
});

test("a file:// link into the agent's checkout opens the changed file", async ({
  page,
}) => {
  await page.getByRole('link', { name: 'the new helpers' }).click();
  const changes = page.getByRole('region', { name: 'Changes' });
  const selected = changes.locator(
    '[data-selected-line]:not([data-column-number])'
  );
  await expect(selected).toHaveText(['pub fn x() {}', 'pub fn y() {}']);
});

test('a link to an unchanged file opens it on GitHub at the head commit', async ({
  page,
}) => {
  await page.getByRole('link', { name: 'docs/guide.md' }).click();
  await expect(
    page.getByRole('list', { name: 'Opened outside' })
  ).toContainText(
    'https://github.com/macro-inc/macro/blob/abc123/docs/guide.md#L3'
  );
  await expect(page.getByRole('region', { name: 'Changes' })).toBeHidden();
});

test('in split view the pointed line scrolls in, not the old line with its number', async ({
  page,
}) => {
  await page.goto(
    '/src/features/changes/browser-test/code-links.html?style=split'
  );
  await page.getByRole('link', { name: 'apps/web/src/long.ts:2' }).click();
  const changes = page.getByRole('region', { name: 'Changes' });
  // The old side's line 2 is a context row 60 rows further down.
  const pointed = changes
    .locator('[data-additions] [data-selected-line]:not([data-column-number])')
    .filter({ hasText: 'row2 = 2' });
  await expect(pointed).toBeInViewport();
});

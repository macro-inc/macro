import { expect, type Page, test } from '@playwright/test';

async function openPanel(page: Page) {
  await page.getByRole('button', { name: 'Show details' }).click();
  const panel = page
    .getByRole('dialog', { name: 'Item details' })
    .or(page.getByRole('complementary', { name: 'Block details' }));
  await expect(panel).toBeVisible();
  return panel;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('lists the people on the thread with their CRM contact and company', async ({
  page,
}) => {
  const panel = await openPanel(page);
  await expect(panel.getByText('People')).toBeVisible();
  const people = panel.getByRole('listitem');
  await expect(people).toHaveCount(3);
  await expect(panel.getByText('me@example.com')).toHaveCount(0);

  const ada = people.filter({ hasText: 'Ada Lovelace' });
  await expect(ada.getByText('From', { exact: true })).toBeVisible();
  await expect(ada.getByText('ada@example.com')).toBeVisible();
  await expect(ada.getByText(/^Last contacted /)).toBeVisible();
  await expect(
    ada.getByRole('link', { name: 'Open engines.example.com' })
  ).toHaveAttribute('href', 'https://engines.example.com');
  await expect(
    ada.getByRole('link', { name: 'Search LinkedIn for Ada Lovelace' })
  ).toHaveAttribute('href', /keywords=Ada\+Lovelace\+Analytical\+Engines/);
  await ada
    .getByRole('button', { name: 'Open company Analytical Engines' })
    .click();
  await expect(page.getByRole('status', { name: 'Preview action' })).toHaveText(
    'Opened company company-engines'
  );

  const grace = people.filter({ hasText: 'Grace Hopper' });
  await expect(grace.getByText('Cc', { exact: true })).toBeVisible();
  await expect(
    grace.getByRole('button', { name: /^Open company/ })
  ).toHaveCount(0);

  const unknown = people.filter({ hasText: 'unknown@example.net' });
  await expect(unknown.getByRole('link')).toHaveCount(0);
});

test('remembers a collapsed People section across reloads', async ({
  page,
}) => {
  let panel = await openPanel(page);
  await expect(panel.getByText('Ada Lovelace')).toBeVisible();
  await panel.getByRole('button', { name: /^People/ }).click();
  await expect(panel.getByText('Ada Lovelace')).toBeHidden();

  await page.reload();
  panel = await openPanel(page);
  await expect(panel.getByRole('button', { name: /^People/ })).toBeVisible();
  await expect(panel.getByText('Ada Lovelace')).toBeHidden();

  await panel.getByRole('button', { name: /^People/ }).click();
  await expect(panel.getByText('Ada Lovelace')).toBeVisible();
  await page.reload();
  panel = await openPanel(page);
  await expect(panel.getByText('Ada Lovelace')).toBeVisible();
});

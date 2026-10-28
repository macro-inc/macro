import { expect, test } from '@playwright/test';

test('reply defaults to its alias and selections retain the owning inbox', async ({
  page,
}) => {
  await page.goto('/?senders');
  await expect(page.getByTestId('sender')).toHaveText(
    'owned:resident@example.com'
  );
  const from = page.getByRole('button', { name: 'From address' });
  await from.click();
  await expect(page.getByRole('menuitem')).toHaveCount(4);
  await page
    .getByRole('menuitem', {
      name: 'Resident team <resident@example.com>',
      exact: true,
    })
    .nth(1)
    .click();
  await expect(page.getByTestId('sender')).toHaveText(
    'delegated:resident@example.com'
  );
  await from.press('Enter');
  await page
    .getByRole('menuitem', { name: 'base@example.com', exact: true })
    .press('Enter');
  await expect(page.getByTestId('sender')).toHaveText('owned:base@example.com');
});

test('an unavailable saved alias does not select the sole primary inbox and can still be cleared', async ({
  page,
}) => {
  await page.goto('/?senders');
  const sidebar = page.getByRole('navigation', { name: 'Inboxes' });
  await sidebar
    .getByRole('button', { name: 'resident@example.com', exact: true })
    .first()
    .click();
  await page
    .getByRole('button', { name: 'Simulate unavailable aliases' })
    .click();
  await expect(page.getByTestId('alias-filter')).toContainText(
    'resident@example.com'
  );
  await expect(
    sidebar.getByRole('button', { name: 'base@example.com', exact: true })
  ).not.toHaveAttribute('aria-current', 'true');
  await sidebar.getByRole('button', { name: 'All inboxes' }).click();
  await expect(page.getByTestId('alias-filter')).toHaveText('{}');
  await expect(
    sidebar.getByRole('button', { name: 'base@example.com', exact: true })
  ).toHaveAttribute('aria-current', 'true');
});

test('sidebar aliases select independently and All clears both filters', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?senders');
  const sidebar = page.getByRole('navigation', { name: 'Inboxes' });
  const aliases = sidebar.getByRole('button', {
    name: 'resident@example.com',
    exact: true,
  });
  await aliases.nth(0).click();
  await expect(page.getByTestId('alias-filter')).toContainText(
    '"inboxId":"owned"'
  );
  await expect(aliases.nth(0)).toHaveAttribute('aria-current', 'true');
  await aliases.nth(1).click();
  await expect(page.getByTestId('alias-filter')).toContainText(
    '"inboxId":"delegated"'
  );
  await expect(aliases.nth(1)).toHaveAttribute('aria-current', 'true');
  await sidebar.getByRole('button', { name: 'All inboxes' }).click();
  await expect(page.getByTestId('alias-filter')).toHaveText('{}');
});

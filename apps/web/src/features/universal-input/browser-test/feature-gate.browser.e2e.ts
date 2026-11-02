import { expect, test } from '@playwright/test';

test('enables the composer from its rollout flag without a local preference or email gate', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'macro:experimental:god-mode:experimental-fixture',
      'false'
    );
  });
  await page.goto('/?command-menu&eligible&external');
  await page
    .getByRole('button', { name: 'Open Command K', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByPlaceholder('Search...', { exact: true })
    .fill('notification clicks are broken');
  await expect(
    dialog.getByRole('button', { name: 'Create task', exact: true })
  ).toBeEnabled();
});

test('keeps ordinary Command K search when the rollout flag is off', async ({
  page,
}) => {
  await page.goto('/?command-menu&eligible&no-universal');
  await page
    .getByRole('button', { name: 'Open Command K', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  const input = dialog.getByPlaceholder('Search...', { exact: true });
  await input.fill('notification clicks are broken');
  await expect(input).toHaveValue('notification clicks are broken');
  await expect(
    dialog.getByRole('textbox', { name: 'Your input', exact: true })
  ).not.toBeVisible();
});

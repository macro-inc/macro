import { expect, type Page, test } from '@playwright/test';

const prompt = (page: Page) =>
  page.getByText('Enable Browser Notifications', { exact: true });

const press = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true }).click();

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(prompt(page)).toBeVisible();
});

test('steps aside while a popover is open', async ({ page }) => {
  await press(page, 'Open popover');
  await expect(page.getByText('Event details')).toBeVisible();
  await expect(prompt(page)).toBeHidden();

  await press(page, 'Close popover');
  await expect(prompt(page)).toBeVisible();
});

test('steps aside while a dialog or drawer is open', async ({ page }) => {
  await press(page, 'Open dialog');
  await expect(page.getByText('Delete event')).toBeVisible();
  await expect(prompt(page)).toBeHidden();

  await press(page, 'Close dialog');
  await expect(prompt(page)).toBeVisible();
});

test('steps aside while a full-screen dialog is open', async ({ page }) => {
  await press(page, 'Open full-screen dialog');
  await expect(page.getByText('Reply composer')).toBeVisible();
  await expect(prompt(page)).toBeHidden();

  await press(page, 'Close full-screen dialog');
  await expect(prompt(page)).toBeVisible();
});

test('waits for a presented surface that holds prompts', async ({ page }) => {
  await press(page, 'Toggle composer');
  await expect(prompt(page)).toBeHidden();

  await press(page, 'Toggle composer background');
  await expect(prompt(page)).toBeVisible();

  await press(page, 'Toggle composer background');
  await expect(prompt(page)).toBeHidden();

  await press(page, 'Toggle composer inert');
  await expect(prompt(page)).toBeVisible();

  await press(page, 'Toggle composer inert');
  await expect(prompt(page)).toBeHidden();

  await press(page, 'Toggle composer');
  await expect(prompt(page)).toBeVisible();
});

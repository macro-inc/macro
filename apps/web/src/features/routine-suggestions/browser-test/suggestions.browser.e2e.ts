import { expect, test } from '@playwright/test';

const fixture =
  '/src/features/routine-suggestions/browser-test/suggestions.html';

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('https://**', (route) => route.abort());
  await page.route('**/__macro_dev/**', (route) => route.abort());
});

test('enables a suggestion in one click and an edited one after a retry', async ({
  page,
}) => {
  await page.goto(fixture, { waitUntil: 'domcontentloaded' });
  const sidebar = page.getByRole('complementary', { name: 'Email sidebar' });
  await sidebar.getByRole('button', { name: /Suggested routines/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Routines for Email' });
  await expect(dialog.getByRole('listitem')).toHaveCount(3);
  await expect(
    dialog.getByText('When a new email arrives').first()
  ).toBeVisible();
  await expect(dialog.getByText('Weekdays at 8:30 AM')).toBeVisible();

  // The modal hides the page from the accessibility tree; read the probe directly.
  const created = page.locator('output[aria-label="Created routines"]');
  // The first create fails; the row says so and Enable stays available.
  await dialog
    .getByRole('button', { name: 'Enable Tag invoices and receipts' })
    .click();
  await expect(dialog.getByRole('alert')).toContainText('The server is busy.');
  await dialog
    .getByRole('button', { name: 'Enable Tag invoices and receipts' })
    .click();
  await expect(created).toHaveText('Tag invoices and receipts');
  await expect(dialog.getByRole('button', { name: 'Enabled' })).toBeVisible();

  // Expand, rename, and enable the edited routine.
  await dialog.getByRole('button', { name: /^Alert me about Acme/ }).click();
  const name = dialog.getByRole('textbox', { name: 'Name' });
  await name.fill('Acme renewal alerts');
  await dialog
    .getByRole('button', { name: 'Enable Acme renewal alerts' })
    .click();
  await expect(created).toHaveText(
    'Tag invoices and receipts | Acme renewal alerts'
  );
  await expect(name).toBeDisabled();
});

test('opens the full editor from More options and dismisses the card', async ({
  page,
}) => {
  await page.goto(fixture, { waitUntil: 'domcontentloaded' });
  const sidebar = page.getByRole('complementary', { name: 'Email sidebar' });
  await sidebar.getByRole('button', { name: /Suggested routines/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Routines for Email' });
  await dialog.getByRole('button', { name: /^Morning inbox digest/ }).click();
  await dialog.getByRole('button', { name: 'More options' }).click();
  await expect(
    page.locator('output[aria-label="Created routines"]')
  ).toHaveText('edit:Morning inbox digest');
  await page.keyboard.press('Escape');
  await sidebar
    .getByRole('button', { name: 'Dismiss suggested routines' })
    .click();
  await expect(
    sidebar.getByRole('button', { name: /Suggested routines/ })
  ).toHaveCount(0);
});

test('shows the suggestions in a phone sheet', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('https://**', (route) => route.abort());
  await page.goto(fixture, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Suggested routines/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Routines for Email' });
  await expect(sheet.getByRole('listitem')).toHaveCount(3);
  await sheet
    .getByRole('button', { name: 'Enable Morning inbox digest' })
    .click();
  await expect(sheet.getByRole('alert')).toContainText('The server is busy.');
  await context.close();
});

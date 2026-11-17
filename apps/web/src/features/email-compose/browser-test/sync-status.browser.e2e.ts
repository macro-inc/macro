import { expect, type Page, test } from '@playwright/test';

const composer = (page: Page) => page.getByRole('region', { name: 'Composer' });
const alert = (page: Page) => composer(page).getByRole('alert');
const notice = (page: Page) => composer(page).getByRole('status');

async function open(page: Page) {
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.clock.install();
  // The fixture is compiled on demand, and a load can come up empty.
  await expect(async () => {
    await page.goto('/?sync-status');
    await expect(composer(page)).toContainText('Message body');
  }).toPass({ timeout: 60_000 });
}

/** The banner states a user can meet, in the order a bad day produces them. */
async function exerciseBanner(page: Page) {
  await open(page);
  await expect(alert(page)).toHaveCount(0);
  await expect(notice(page)).toHaveCount(0);

  // Typing, saving and discarding are silent, however long the server takes.
  for (const status of ['dirty', 'queued', 'deleting']) {
    await page.getByRole('button', { name: `copy ${status}` }).click();
    await page.clock.runFor(30_000);
    await expect(alert(page)).toHaveCount(0);
    await expect(notice(page)).toHaveCount(0);
  }

  // A refused discard is the user's to retry.
  await page.getByRole('button', { name: 'copy delete-failed' }).click();
  await expect(alert(page)).toContainText('Draft could not be synced');
  await expect(alert(page)).toContainText('Discard could not be confirmed.');
  await expect(
    alert(page).getByRole('button', { name: 'Keep editing' })
  ).toBeVisible();
  await alert(page).getByRole('button', { name: 'Retry discard' }).click();
  await expect(alert(page)).toHaveCount(0);
  await expect(page.getByTestId('retries')).toHaveText('1');

  // So is a save the server refused.
  await page.getByRole('button', { name: 'copy failed' }).click();
  await expect(alert(page)).toContainText(
    'The server could not save this draft.'
  );
  await alert(page).getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(alert(page)).toHaveCount(0);
}

/** Local storage restarting is silent until it has clearly stalled. */
async function exerciseRestart(page: Page) {
  await open(page);
  await page.getByRole('button', { name: 'copy dirty' }).click();
  await page.getByRole('button', { name: 'storage unavailable' }).click();
  // Each automatic attempt passes through both states.
  await page.clock.runFor(7_000);
  await page.getByRole('button', { name: 'storage recovering' }).click();
  await page.clock.runFor(7_000);
  await page.getByRole('button', { name: 'storage unavailable' }).click();
  await expect(alert(page)).toHaveCount(0);
  await expect(notice(page)).toHaveCount(0);

  await page.clock.runFor(2_000);
  await expect(notice(page)).toContainText(
    'Saved on this device; waiting to sync'
  );
  await expect(alert(page)).toHaveCount(0);
  await expect(
    notice(page).getByRole('button', { name: 'Retry', exact: true })
  ).toBeVisible();

  await page.getByRole('button', { name: 'storage ready' }).click();
  await expect(notice(page)).toHaveCount(0);

  // Storage that cannot restart by itself asks for a reload at once.
  await page.getByRole('button', { name: 'storage recovery-required' }).click();
  await expect(alert(page)).toContainText('reload Macro');
  await expect(
    alert(page).getByRole('button', { name: 'Reload', exact: true })
  ).toBeVisible();
}

test('the sync banner appears only for failures the user must act on', async ({
  page,
}) => {
  await exerciseBanner(page);
});

test('a restarting local store is silent until it stalls', async ({ page }) => {
  await exerciseRestart(page);
});

test('offline edits show the quiet waiting notice, not an alert', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'copy dirty' }).click();
  await page.getByRole('button', { name: 'toggle offline' }).click();
  await expect(notice(page)).toContainText(
    'Saved on this device; waiting to sync'
  );
  await expect(alert(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'copy synced' }).click();
  await expect(notice(page)).toHaveCount(0);
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 780 }, hasTouch: true });
  test('the sync banner appears only for failures the user must act on', async ({
    page,
  }) => {
    await exerciseBanner(page);
  });
  test('a restarting local store is silent until it stalls', async ({
    page,
  }) => {
    await exerciseRestart(page);
  });
});

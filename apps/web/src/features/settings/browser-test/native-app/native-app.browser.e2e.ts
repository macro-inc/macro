import { expect, type Page, test } from '@playwright/test';

/** Where to also save every screenshot; unset keeps them in test-results. */
const screenshotDirectory = process.env.NATIVE_APP_SCREENSHOT_DIR;

async function snap(page: Page, name: string) {
  const project = test.info().project.name;
  const file = `${project}-${name}.png`;
  await page.screenshot({
    path: screenshotDirectory
      ? `${screenshotDirectory}/${file}`
      : test.info().outputPath(file),
    fullPage: true,
  });
}

function commands(page: Page) {
  return page.evaluate(
    () => (window as unknown as { nativeCommands: string[] }).nativeCommands
  );
}

test('the iOS app lists its version, builds and a downloadable update', async ({
  page,
}) => {
  await page.goto('/?platform=ios&source=ota&bundle=UpdateFound');

  await expect(page.getByRole('heading', { name: 'iOS App' })).toBeVisible();
  await expect(page.getByText('2026.1119.1')).toBeVisible();
  await expect(page.getByText('342')).toBeVisible();
  await expect(page.getByText('Bundle date')).toBeVisible();
  await expect(page.getByText('Update available: v2026.1121.1')).toBeVisible();
  await expect(page.getByText('Desktop app update')).toHaveCount(0);
  await snap(page, 'ios-update-found');

  await page.getByRole('button', { name: 'Download' }).click();
  expect(await commands(page)).toContain('grant_bundle_update');
});

test('the Android app runs its built-in bundle and can check for updates', async ({
  page,
}) => {
  await page.goto('/?platform=android');

  await expect(
    page.getByRole('heading', { name: 'Android App' })
  ).toBeVisible();
  await expect(page.getByText('Built into the app')).toBeVisible();
  await page.getByRole('button', { name: 'Check for updates' }).click();
  expect(await commands(page)).toContain('check_for_update');
  await snap(page, 'android-idle');
});

test('the desktop app restarts into a downloaded app update', async ({
  page,
}) => {
  await page.goto('/?platform=desktop&native=Ready&bundle=Completed');

  await expect(
    page.getByRole('heading', { name: 'Desktop App' })
  ).toBeVisible();
  await expect(page.getByText('App update', { exact: true })).toHaveCount(0);
  await snap(page, 'desktop-ready');

  await page.getByRole('button', { name: 'Restart to update' }).click();
  expect(await commands(page)).toContain('restart_native_update');
});

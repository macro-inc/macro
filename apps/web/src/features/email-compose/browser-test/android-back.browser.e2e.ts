import { expect, type Page, test } from '@playwright/test';

/** `MobilePlugin.kt` dispatches exactly this once the IME is already hidden. */
async function pressSystemBack(page: Page) {
  await page.evaluate(() =>
    window.dispatchEvent(new Event('android-back', { cancelable: true }))
  );
}

test.use({ viewport: { width: 390, height: 720 } });

test('system Back on a dirty draft asks before leaving the composer', async ({
  page,
}) => {
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.goto('/?android-back');
  const composer = page.getByRole('region', { name: 'Compose email' });
  await expect(composer).toBeVisible();

  await page.getByRole('textbox', { name: 'Message' }).fill('Half-written');
  await expect(page.getByTestId('draft-dirty')).toHaveText('true');

  await pressSystemBack(page);
  const options = page.getByRole('dialog', { name: 'Draft options' });
  const saveDraft = options.getByRole('button', { name: 'Save Draft' });
  // The sheet slides in, so wait for both choices to settle on screen.
  await expect(options).not.toHaveAttribute('data-transitioning');
  await expect(
    options.getByRole('button', { name: 'Delete Draft' })
  ).toBeInViewport();
  await expect(saveDraft).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId('navigated-back')).toHaveText('0');
  await expect(composer).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('draft-options.png') });

  await saveDraft.click();
  await expect(composer).toHaveCount(0);
});

test('system Back leaves an untouched composer immediately', async ({
  page,
}) => {
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.goto('/?android-back');
  await expect(page.getByTestId('draft-dirty')).toHaveText('false');

  await pressSystemBack(page);
  await expect(page.getByRole('dialog', { name: 'Draft options' })).toHaveCount(
    0
  );
  await expect(page.getByTestId('navigated-back')).toHaveText('1');
  await expect(page.getByText('Back at the mail list')).toBeVisible();
});

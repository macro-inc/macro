import { expect, type Page, test } from '@playwright/test';

async function exerciseRecovery(page: Page) {
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.goto('/?recovery');
  const editor = page.getByRole('textbox', { name: 'Message' });
  await editor.fill('Queued text');
  await expect(page.getByTestId('save-count')).toHaveText('1');
  await page.getByRole('button', { name: 'Reject background save' }).click();
  const notice = page
    .getByRole('status')
    .filter({ hasText: 'Draft could not be saved' });
  await expect(notice).toBeVisible();
  await editor.fill('Newest edits after rejection');
  await page.getByRole('button', { name: 'Show transient notice' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Copied' })
  ).toHaveCount(0, { timeout: 10_000 });
  await expect(notice).toBeVisible();
  await expect(page.getByTestId('save-count')).toHaveText('1');
  await expect(
    notice.getByText('Your edits are still in this editor.', { exact: false })
  ).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('draft-recovery.png') });
  await notice.getByRole('button', { name: 'Save as new draft' }).click();
  await expect(notice).toHaveCount(0);
  await expect(page.getByTestId('save-count')).toHaveText('2');
  await expect(page.getByTestId('saved-body')).toContainText(
    'Newest edits after rejection'
  );
  await expect(editor).toHaveValue('Newest edits after rejection');
  const ids = JSON.parse(
    (await page.getByTestId('saved-draft-ids').textContent()) ?? '[]'
  );
  expect(ids[0]).not.toBe(ids[1]);
  await page.getByRole('button', { name: 'Reject background save' }).click();
  await expect(notice).toBeVisible();
  await page.getByRole('button', { name: 'Close composer' }).click();
  await expect(notice).toHaveCount(0);
}

test('background rejection preserves new edits and offers explicit recovery', async ({
  page,
}) => {
  await exerciseRecovery(page);
});

test.describe('mobile recovery', () => {
  test.use({ viewport: { width: 390, height: 780 }, hasTouch: true });
  test('keeps the recovery action and explanation visible', async ({
    page,
  }) => {
    await exerciseRecovery(page);
  });
});

test('an already-sent background save clears the draft without offering recovery', async ({
  page,
}) => {
  await page.goto('/?recovery');
  await page
    .getByRole('textbox', { name: 'Message' })
    .fill('Already delivered');
  await expect(page.getByTestId('save-count')).toHaveText('1');
  await page.getByRole('button', { name: 'Report already sent' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'This email was already sent' })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Save as new draft' })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Close composer' }).click();
  await expect(
    page.getByRole('region', { name: 'Draft recovery' })
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Save as new draft' })
  ).toHaveCount(0);
});

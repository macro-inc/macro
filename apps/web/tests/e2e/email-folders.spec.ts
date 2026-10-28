import { expect, test } from '@playwright/test';

test('restore controls work in Spam and Trash', async ({
  page,
  isMobile,
}, info) => {
  await page.goto('/tests/e2e/fixtures/email-folders.html');
  const rows = page
    .getByRole('list', { name: 'Folder emails' })
    .getByRole('listitem');
  await expect(rows).toHaveCount(2);
  if (!isMobile) await rows.first().hover();
  await page
    .getByRole('button', { name: 'Not spam', exact: true })
    .first()
    .click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Outlook');
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Trash', exact: true })
  ).toBeVisible();
  await expect(rows).toHaveCount(2);
  if (!isMobile) await rows.last().hover();
  await page.screenshot({ path: info.outputPath('trash-controls.png') });
  await page
    .getByRole('button', { name: 'Restore', exact: true })
    .last()
    .click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Gmail');
});

test('failed restore remains available for retry', async ({
  page,
  isMobile,
}) => {
  await page.goto('/tests/e2e/fixtures/email-folders.html?fail');
  const restore = page
    .getByRole('button', { name: 'Not spam', exact: true })
    .first();
  if (!isMobile) await page.getByRole('listitem').first().hover();
  await restore.click();
  await expect(page.getByRole('alert')).toContainText(
    'Could not restore email'
  );
  await expect(restore).toBeEnabled();
  await expect(page.getByRole('listitem')).toHaveCount(2);
});

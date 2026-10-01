import { expect, test } from '@playwright/test';

test('queued draft has a visible optimistic thread without viewer metadata', async ({
  page,
}) => {
  await page.goto('/?draft-owner');
  await page
    .getByRole('textbox', { name: 'Subject' })
    .fill('Offline draft before viewer loads');
  await page.getByRole('button', { name: 'Save offline draft' }).click();
  await expect(
    page.getByRole('list', { name: 'Optimistic draft threads' })
  ).toHaveText('Offline draft before viewer loads');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('missing account metadata preserves input and allows saving once available', async ({
  page,
}) => {
  await page.goto('/?draft-owner');
  await page
    .getByRole('checkbox', { name: 'Inbox metadata available' })
    .uncheck();
  await page.getByRole('textbox', { name: 'Subject' }).fill('Keep my draft');
  await page.getByRole('button', { name: 'Save offline draft' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'sending account is available'
  );
  await expect(page.getByRole('listitem')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Subject' })).toHaveValue(
    'Keep my draft'
  );
  await page
    .getByRole('checkbox', { name: 'Inbox metadata available' })
    .check();
  await page.getByRole('button', { name: 'Save offline draft' }).click();
  await expect(page.getByRole('listitem')).toHaveText('Keep my draft');
});

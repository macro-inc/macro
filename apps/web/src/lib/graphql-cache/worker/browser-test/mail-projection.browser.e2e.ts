import { expect, test } from '@playwright/test';

test('a superseded offline create recovers its server identity after reload and unblocks the newer save', async ({
  page,
  context,
}) => {
  await page.goto(`/mail-projection.html?scope=draft-recovery-${Date.now()}`);
  await expect(page.locator('#result')).toHaveAttribute(
    'data-status',
    'ready',
    { timeout: 60_000 }
  );
  await context.setOffline(true);
  for (let i = 0; i < 2; i++) {
    await page.locator('#draft-status').evaluate((element) => {
      element.textContent = '';
    });
    await page.getByRole('button', { name: 'Create offline draft' }).click();
    await expect(page.locator('#draft-status')).toHaveText('Draft queued');
  }
  await context.setOffline(false);
  await page.reload();
  await expect(page.locator('#result')).toHaveAttribute(
    'data-status',
    'ready',
    { timeout: 60_000 }
  );
  await page.getByRole('button', { name: 'Resume draft sync' }).click();
  await expect(page.locator('#draft-status')).toHaveText(
    'Draft synced after reload; latest edit and server identity confirmed',
    { timeout: 20_000 }
  );
});

test('server-null threads and committed draft deletes leave records and Mail views', async ({
  page,
}) => {
  await page.goto('/mail-projection.html');
  await expect(page.locator('#result')).toHaveAttribute(
    'data-status',
    'ready',
    { timeout: 60_000 }
  );
  await page
    .getByRole('button', { name: 'Check deleted thread cleanup' })
    .click();
  await expect(page.locator('#draft-status')).toHaveText(
    'Deleted threads absent from records and Mail views'
  );
});

test('a new offline draft reaches Drafts and reopens through another cache client', async ({
  page,
  context,
}) => {
  await page.goto('/mail-projection.html');
  await expect(page.locator('#result')).toHaveAttribute(
    'data-status',
    'ready',
    { timeout: 60_000 }
  );
  await context.setOffline(true);
  try {
    await page
      .getByRole('combobox', { name: 'View', exact: true })
      .selectOption('DRAFTS');
    await page.getByRole('button', { name: 'Create offline draft' }).click();
    await expect(page.locator('#draft-status')).toHaveText('Draft queued');
    await expect(page.locator('#rows li').first()).toHaveText(
      'Offline standalone — Not Done'
    );
    await page.getByRole('button', { name: 'Reopen cached draft' }).click();
    await expect(page.locator('#draft-status')).toContainText(
      'Saved on this device'
    );
    await expect(page.locator('#draft-status')).toContainText(
      'recipient@example.com'
    );
    await expect(page.locator('#draft-status')).toContainText('"pending":true');
    await expect(page.locator('#rows li').first()).toHaveText(
      'Offline standalone — Not Done'
    );
  } finally {
    await context.setOffline(false);
  }
});

test('new Mail filter combinations and pagination work offline without bodies or server baselines', async ({
  page,
  context,
}) => {
  await page.goto('/mail-projection.html');
  await expect(page.locator('#result')).toHaveAttribute(
    'data-status',
    'ready',
    { timeout: 60_000 }
  );
  await expect(page.locator('#rows li')).toHaveCount(10);
  await context.setOffline(true);
  try {
    for (const count of [20, 30, 40, 50, 60, 69]) {
      await page.getByRole('button', { name: 'Load more cached mail' }).click();
      await expect(page.locator('#rows li')).toHaveCount(count);
    }
    await expect(
      page.getByRole('button', { name: 'Load more cached mail' })
    ).toBeDisabled();
    await page
      .getByRole('combobox', { name: 'View', exact: true })
      .selectOption('INBOX');
    await page
      .getByRole('combobox', { name: 'Signal', exact: true })
      .selectOption('true');
    await page
      .getByRole('combobox', { name: 'Account', exact: true })
      .selectOption('1001');
    await expect(page.locator('#rows li')).toHaveCount(3);
    await page
      .getByRole('combobox', { name: 'Status', exact: true })
      .selectOption('false');
    await expect(page.locator('#rows li')).toHaveCount(0);
    await page
      .getByRole('combobox', { name: 'View', exact: true })
      .selectOption('ALL');
    await expect(page.locator('#rows li')).toHaveCount(4);
    await expect(page.locator('#rows li')).toHaveText([
      / — Done$/,
      / — Done$/,
      / — Done$/,
      / — Done$/,
    ]);
    await page
      .getByRole('combobox', { name: 'Read', exact: true })
      .selectOption('true');
    await expect(page.locator('#rows li')).toHaveCount(0);
    await page
      .getByRole('combobox', { name: 'Read', exact: true })
      .selectOption('false');
    await expect(page.locator('#rows li')).toHaveCount(4);
  } finally {
    await context.setOffline(false);
  }
});

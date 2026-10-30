import { expect, type Page, test } from '@playwright/test';

async function mockFolderApi(page: Page, fail = false) {
  const restored = new Set<string>();
  const writes: { field: string; value: boolean; id: string }[] = [];
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost'
      ? route.continue()
      : route.fulfill({ status: 404, json: {} });
  });
  await page.route('**/items/soup/ast**', async (route) => {
    const { emailView } = route.request().postDataJSON();
    const items = ['Gmail', 'Outlook'].flatMap((provider, index) => {
      const id = `019f0000-0000-7000-8000-00000000000${index + 1}`;
      if (restored.has(`${emailView}:${id}`)) return [];
      return [
        {
          tag: 'emailThread',
          frecency_score: 0,
          is_favorited: false,
          data: {
            id,
            name: `${provider} folder message`,
            ownerId: 'macro|fixture@example.com',
            createdAt: '2026-10-01T12:00:00Z',
            updatedAt: '2026-10-01T12:00:00Z',
            sortTs: '2026-10-01T12:00:00Z',
            isRead: true,
            isDraft: false,
            isImportant: false,
            isSignal: false,
            inboxVisible: false,
            senderName: provider,
            senderEmail: 'sender@example.com',
            properties: [],
            labels: [],
            participants: [],
            attachments: [],
          },
        },
      ];
    });
    await route.fulfill({ json: { items, next_cursor: null } });
  });
  await page.route('**/email/threads/*/state', async (route) => {
    const { field, value } = route.request().postDataJSON();
    const id = new URL(route.request().url()).pathname.split('/').at(-2)!;
    writes.push({ field, value, id });
    if (fail)
      return route.fulfill({ status: 503, json: { message: 'Retry restore' } });
    restored.add(`${field === 'junk' ? 'spam' : 'trash'}:${id}`);
    await route.fulfill({ json: {} });
  });
  return writes;
}

test('restore controls work in Spam and Trash', async ({
  page,
  isMobile,
}, info) => {
  const writes = await mockFolderApi(page);
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
  expect(writes.map(({ field, value }) => ({ field, value }))).toEqual([
    { field: 'junk', value: false },
    { field: 'trashed', value: false },
  ]);
});

test('failed restore remains available for retry', async ({
  page,
  isMobile,
}) => {
  await mockFolderApi(page, true);
  await page.goto('/tests/e2e/fixtures/email-folders.html');
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

test('pending restore preserves a selection made in another folder', async ({
  page,
  isMobile,
}) => {
  await mockFolderApi(page);
  const started = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  await page.route('**/email/threads/*/state', async (route) => {
    started.resolve();
    await released.promise;
    await route.fallback();
  });
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
  await started.promise;
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await expect(rows).toHaveCount(2);
  const selection = rows.last().getByRole('checkbox');
  await selection.click();
  await expect(selection).toBeChecked();
  released.resolve();
  await expect(
    page.getByRole('button', { name: 'Restore', exact: true }).last()
  ).toBeEnabled();
  await expect(selection).toBeChecked();
});

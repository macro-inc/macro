import { expect, test } from '@playwright/test';

const fixture = '/src/features/connector-import/browser-test/import.html';

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('https://**', (route) => route.abort());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await page.goto(fixture, { waitUntil: 'domcontentloaded' });
});

test('hands a Notion import from the Drive card to the agent', async ({
  page,
}) => {
  const sidebar = page.getByRole('complementary', { name: 'files sidebar' });
  await expect(
    sidebar.getByRole('list', { name: /Notion, Google Drive, Dropbox/ })
  ).toBeVisible();
  await sidebar
    .getByRole('button', { name: 'Import files', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Connect Notion' }).click();
  await dialog.getByRole('button', { name: 'Import from Notion' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('status', { name: 'Agent handoff' })).toHaveText(
    'Import my Notion workspace into Macro.'
  );
});

test('connects GitHub natively, then hands its import to the agent', async ({
  page,
}) => {
  const sidebar = page.getByRole('complementary', { name: 'tasks sidebar' });
  await sidebar
    .getByRole('button', { name: 'Import tasks', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Connect GitHub' }).click();
  await dialog.getByRole('button', { name: 'Import from GitHub' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('status', { name: 'Agent handoff' })).toHaveText(
    'Import my most recent issues and tasks from GitHub into Macro tasks.'
  );
});

test('hands a connected Pipedream provider to the agent', async ({ page }) => {
  const sidebar = page.getByRole('complementary', { name: 'tasks sidebar' });
  await sidebar
    .getByRole('button', { name: 'Import tasks', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Connect Jira' }).click();
  await dialog.getByRole('button', { name: 'Import from Jira' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('status', { name: 'Agent handoff' })).toHaveText(
    'Import my Jira workspace into Macro.'
  );
});

test('hands Slack channels to the agent or history to the archive upload', async ({
  page,
}) => {
  const sidebar = page.getByRole('complementary', { name: 'channels sidebar' });
  const open = () =>
    sidebar
      .getByRole('button', { name: 'Import from Slack', exact: true })
      .click();
  await open();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Connect Slack' }).click();
  await dialog.getByRole('button', { name: 'Import from Slack' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('status', { name: 'Agent handoff' })).toHaveText(
    'Import my most recent channels from Slack into Macro channels.'
  );
  await open();
  await dialog.getByRole('button', { name: /Import with history/ }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('status', { name: 'Agent handoff' })).toHaveText(
    'Slack export upload'
  );
});

test('offers local file and folder uploads in the Files dialog', async ({
  page,
}) => {
  const sidebar = page.getByRole('complementary', { name: 'files sidebar' });
  await sidebar
    .getByRole('button', { name: 'Import files', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /Upload a folder/ }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('status', { name: 'Agent handoff' })).toHaveText(
    'Upload a folder'
  );
});

for (const provider of ['Linear', 'Jira']) {
  test(`opens the ${provider} workspace importer on a phone`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole('complementary', { name: 'tasks sidebar' })
      .getByRole('button', { name: 'Import tasks', exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: `Connect ${provider}` }).click();
    await dialog
      .getByRole('button', { name: `Import from ${provider}` })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole('status', { name: 'Agent handoff' })
    ).toHaveText(`Import my ${provider} workspace into Macro.`);
  });
}

import { expect, test } from '@playwright/test';

const fixture = '/src/features/connector-import/browser-test/import.html';

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('https://**', (route) => route.abort());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await page.goto(fixture, { waitUntil: 'domcontentloaded' });
});

test('imports selected Notion pages from the Drive card', async ({ page }) => {
  const sidebar = page.getByRole('complementary', { name: 'files sidebar' });
  await expect(
    sidebar.getByRole('list', { name: /Notion, Google Drive, Dropbox/ })
  ).toBeVisible();
  await sidebar
    .getByRole('button', { name: 'Import files', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Connect Notion' }).click();
  await expect(dialog.getByText('Import from Notion')).toBeVisible();
  // The title is the checkbox's label, so clicking it selects the page.
  await dialog.getByText('Q4 planning', { exact: true }).click();
  await expect(
    dialog.getByRole('checkbox', { name: /^Select Q4 planning/ })
  ).toBeChecked();
  await dialog.getByRole('button', { name: 'Import 1' }).click();
  await expect(
    dialog.getByRole('link', { name: 'Open imported Q4 planning' })
  ).toBeVisible();
  await expect(
    sidebar.getByRole('button', { name: 'Import files', exact: true })
  ).toHaveCount(0);
});

test('hands a connected provider without an importer to the agent', async ({
  page,
}) => {
  const sidebar = page.getByRole('complementary', { name: 'tasks sidebar' });
  await sidebar
    .getByRole('button', { name: 'Import tasks', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Connect Jira' }).click();
  await dialog.getByRole('button', { name: 'Import from Jira' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('status', { name: 'Agent handoff' })).toHaveText(
    'Import my most recent issues and tasks from Jira into Macro tasks.'
  );
});

test('picks Slack channels or hands history to the archive upload', async ({
  page,
}) => {
  const sidebar = page.getByRole('complementary', { name: 'channels sidebar' });
  await sidebar
    .getByRole('button', { name: 'Import from Slack', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Connect Slack' }).click();
  await dialog.getByText('#general', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Import 1' }).click();
  await expect(
    dialog.getByRole('link', { name: 'Open imported #general' })
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Back to apps' }).click();
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

import { expect, test } from '@playwright/test';

const fixture = '/src/features/import-jobs/browser-test/tray.html';

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('https://**', (route) => route.abort());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await page.goto(fixture, { waitUntil: 'domcontentloaded' });
});

test('follows a Notion import from scanning to done, then dismisses it', async ({
  page,
}) => {
  const tray = page.getByRole('region', { name: 'Imports' });
  await expect(tray).toHaveCount(0);

  await page.getByRole('button', { name: 'Scan Notion' }).click();
  const notion = tray.getByRole('listitem', { name: 'Notion' });
  await expect(notion).toContainText('Scanning 120 pages');
  await expect(
    notion.getByRole('button', { name: 'Open the Notion import' })
  ).toHaveCount(0);
  await expect(
    notion.getByRole('button', { name: 'Dismiss the Notion import' })
  ).toHaveCount(0);

  await page.getByRole('button', { name: 'Write Notion' }).click();
  await expect(notion).toContainText('Importing 31 of 124');
  await expect(notion.getByRole('progressbar')).toHaveAttribute(
    'aria-valuenow',
    '25'
  );
  await notion.getByRole('button', { name: 'Open the Notion import' }).click();
  await expect(page.getByRole('status', { name: 'Opened session' })).toHaveText(
    'notion-session'
  );

  await page.getByRole('button', { name: 'Finish Notion' }).click();
  await expect(notion).toContainText('Imported');
  await notion
    .getByRole('button', { name: 'Dismiss the Notion import' })
    .click();
  await expect(tray).toHaveCount(0);
});

test('shows a failed import beside a running one and collapses', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Scan Notion' }).click();
  await page.getByRole('button', { name: 'Fail Jira' }).click();
  const tray = page.getByRole('region', { name: 'Imports' });
  await expect(tray.getByRole('listitem')).toHaveCount(2);
  await expect(tray.getByRole('listitem', { name: 'Jira' })).toContainText(
    'Import failed'
  );

  await tray.getByRole('button', { name: 'Hide imports' }).click();
  await expect(tray.getByRole('listitem')).toHaveCount(0);
  await expect(tray.getByRole('button', { name: 'Show imports' })).toHaveText(
    '2 imports'
  );

  await tray.getByRole('button', { name: 'Show imports' }).click();
  await tray
    .getByRole('listitem', { name: 'Jira' })
    .getByRole('button', { name: 'Dismiss the Jira import' })
    .click();
  await expect(tray.getByRole('listitem')).toHaveCount(1);
  await expect(tray.getByRole('listitem', { name: 'Notion' })).toBeVisible();
});

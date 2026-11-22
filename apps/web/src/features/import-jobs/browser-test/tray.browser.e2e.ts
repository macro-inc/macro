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
  const button = page.getByRole('button', { name: /^\d+ imports?$/ });
  const tray = page.getByRole('dialog', { name: 'Imports' });
  await expect(button).toHaveCount(0);

  await page.getByRole('button', { name: 'Scan Notion' }).click();
  await expect(button).toHaveAccessibleName('1 import');
  // The rail button stays closed until it is pressed, so nothing covers the page.
  await expect(tray).toHaveCount(0);
  await button.click();
  const notion = tray.getByRole('listitem', { name: 'Notion' });
  await expect(notion).toContainText('Scanning 120 pages');
  await expect(
    notion.getByRole('button', { name: 'Open the Notion import' })
  ).toHaveCount(0);
  await expect(
    notion.getByRole('button', { name: 'Dismiss the Notion import' })
  ).toHaveCount(0);

  // Pressing anything outside the list closes it.
  await page.getByRole('button', { name: 'Write Notion' }).click();
  await expect(tray).toHaveCount(0);
  await button.click();
  await expect(notion).toContainText('Importing 31 of 124');
  await expect(notion.getByRole('progressbar')).toHaveAttribute(
    'aria-valuenow',
    '25'
  );
  await notion.getByRole('button', { name: 'Open the Notion import' }).click();
  await expect(page.getByRole('status', { name: 'Opened session' })).toHaveText(
    'notion-session'
  );
  // Opening a session closes the list.
  await expect(tray).toHaveCount(0);

  await page.getByRole('button', { name: 'Finish Notion' }).click();
  await button.click();
  await expect(notion).toContainText('Imported');
  await notion
    .getByRole('button', { name: 'Dismiss the Notion import' })
    .click();
  await expect(tray).toHaveCount(0);
  await expect(button).toHaveCount(0);
});

test('marks a failed import on the rail button and lists it beside a running one', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Scan Notion' }).click();
  await page.getByRole('button', { name: 'Fail Jira' }).click();
  const button = page.getByRole('button', { name: '2 imports' });
  await expect(button).toHaveAttribute('aria-description', 'An import failed');
  await button.click();
  const tray = page.getByRole('dialog', { name: 'Imports' });
  await expect(tray.getByRole('listitem')).toHaveCount(2);
  await expect(tray.getByRole('listitem', { name: 'Jira' })).toContainText(
    'Failed: Jira access lost'
  );
  await tray
    .getByRole('listitem', { name: 'Jira' })
    .getByRole('button', { name: 'Reconnect Jira' })
    .click();
  await expect(page.getByLabel('Opened session')).toHaveText('reconnect:jira');

  await page.keyboard.press('Escape');
  await expect(tray).toHaveCount(0);

  await button.click();
  await tray
    .getByRole('listitem', { name: 'Jira' })
    .getByRole('button', { name: 'Dismiss the Jira import' })
    .click();
  await expect(tray.getByRole('listitem')).toHaveCount(1);
  await expect(tray.getByRole('listitem', { name: 'Notion' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: '1 import' })
  ).not.toHaveAttribute('aria-description');
});

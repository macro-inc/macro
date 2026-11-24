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
  const tray = page.getByRole('dialog', { name: /^Imports · \d+$/ });
  await expect(button).toHaveCount(0);

  await page.getByRole('button', { name: 'Scan Notion' }).click();
  await expect(button).toHaveAccessibleName('1 import');
  // The rail button stays closed until it is pressed, so nothing covers the page.
  await expect(tray).toHaveCount(0);
  await button.click();
  const notion = tray.getByRole('listitem', { name: 'Notion' });
  await expect(notion).toContainText('Scanning 120 pages');
  await expect(
    notion.getByRole('button', {
      name: 'Open the chat that ran the Notion import',
    })
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
  await notion
    .getByRole('button', { name: 'Open the chat that ran the Notion import' })
    .click();
  await expect(page.getByRole('status', { name: 'Opened session' })).toHaveText(
    'notion-session'
  );
  // Opening a session closes the list and leaves focus to the session's
  // split, not the rail button.
  await expect(tray).toHaveCount(0);
  await page.waitForTimeout(100);
  await expect(button).not.toBeFocused();
  // Back in the list, the row says that chat is the one showing, and still
  // goes there.
  await button.click();
  await notion.getByRole('button', { name: 'You’re in this chat' }).click();
  await expect(tray).toHaveCount(0);

  await page.getByRole('button', { name: 'Finish Notion' }).click();
  await button.click();
  await expect(notion).toContainText('Imported');
  await notion
    .getByRole('button', { name: 'Dismiss the Notion import' })
    .click();
  await expect(tray).toHaveCount(0);
  await expect(button).toHaveCount(0);
  // The rail's button vanished with its last row, so focus moves to the next
  // rail control instead of falling to the page.
  await expect(page.getByRole('button', { name: 'Help' })).toBeFocused();

  // The next import starts closed again.
  await page.getByRole('button', { name: 'Scan Notion' }).click();
  await expect(button).toHaveAccessibleName('1 import');
  await expect(tray).toHaveCount(0);
});

test('marks a failed import on the rail button and lists it beside a running one', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Scan Notion' }).click();
  await page.getByRole('button', { name: 'Fail Jira' }).click();
  const button = page.getByRole('button', { name: '2 imports' });
  await expect(button).toHaveAttribute('aria-description', 'An import failed');
  await button.click();
  const tray = page.getByRole('dialog', { name: /^Imports · \d+$/ });
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

test('keeps the corner pill on tablets, where the rail is not shown', async ({
  page,
}) => {
  await page.goto(`${fixture}?layout=corner`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('button', { name: 'Fail Jira' }).click();
  const tray = page.getByRole('region', { name: 'Imports' });
  await expect(tray.getByRole('listitem', { name: 'Jira' })).toContainText(
    'Failed: Jira access lost'
  );
  // The pill and its open list sit above the touch layout's bottom-right
  // buttons, not on them.
  const fresh = await page.getByRole('button', { name: '+ New' }).boundingBox();
  const list = await tray.boundingBox();
  expect(fresh && list).toBeTruthy();
  if (fresh && list) {
    expect(list.y + list.height).toBeLessThanOrEqual(fresh.y);
  }
  const status = tray
    .getByRole('listitem', { name: 'Jira' })
    .locator('[data-slot="item-description"]');
  expect(
    await status.evaluate(
      (element) => element.scrollWidth <= element.clientWidth
    )
  ).toBe(true);
  await tray.getByRole('button', { name: 'Hide imports' }).click();
  await expect(tray.getByRole('listitem')).toHaveCount(0);
  await tray.getByRole('button', { name: 'Show imports' }).click();
  await tray
    .getByRole('listitem', { name: 'Jira' })
    .getByRole('button', { name: 'Dismiss the Jira import' })
    .click();
  await expect(tray).toHaveCount(0);
});

test('keeps the rail button readable: no tooltip over its list, a focus ring after Escape, one-line rows', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Scan Notion' }).click();
  await page.getByRole('button', { name: 'Fail Jira' }).click();
  await page.getByRole('button', { name: 'Fail Linear' }).click();
  const button = page.getByRole('button', { name: '3 imports' });
  await button.click();
  const tray = page.getByRole('dialog', { name: 'Imports · 3' });
  await expect(
    tray.getByRole('heading', { name: 'Imports · 3' })
  ).toBeVisible();
  await expect(tray.getByRole('listitem')).toHaveCount(3);

  // Hovering the open button shows no tooltip over the list.
  await button.hover();
  await page.waitForTimeout(1200);
  await expect(page.getByRole('tooltip')).toHaveCount(0);

  // Each row's status stays on one line, even beside its widest action.
  for (const name of ['Notion', 'Jira', 'Linear']) {
    const status = tray
      .getByRole('listitem', { name })
      .locator('[data-slot="item-description"]');
    const fit = await status.evaluate((element) => {
      const height = element.getBoundingClientRect().height;
      const line = Number.parseFloat(getComputedStyle(element).lineHeight);
      return {
        lines: Math.round(height / line),
        clipped: element.scrollWidth > element.clientWidth,
      };
    });
    expect(fit, name).toEqual({ lines: 1, clipped: false });
  }

  await page.mouse.move(600, 100);
  await page.keyboard.press('Escape');
  await expect(tray).toHaveCount(0);
  await expect(button).toBeFocused();
  const ring = await button.evaluate((element) => ({
    visible: element.matches(':focus-visible'),
    shadow: getComputedStyle(element).boxShadow,
  }));
  expect(ring.visible).toBe(true);
  expect(ring.shadow).not.toBe('none');
});

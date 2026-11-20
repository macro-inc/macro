import { expect, type Page, test } from '@playwright/test';

const checks = (page: Page) =>
  page.locator('[data-thread-gutter]').getByRole('button');
const list = (page: Page) => page.locator('[data-channel-notification-list]');
const toggle = (page: Page) =>
  page.getByRole('button', { name: 'Notifications in this channel' });

async function open(page: Page, pane: number) {
  await page.goto(`/gutter.html?pane=${pane}`);
  await expect(page.locator('[data-message="m1"]')).toBeVisible();
}

// A wide pane (340px of gutter): one check per stack, in one lane, and the
// list docked in the gutter beside them.
test('a wide pane docks the list beside one check per stack', async ({
  page,
}) => {
  await open(page, 1600);

  await expect(checks(page)).toHaveCount(3);
  const lanes = await checks(page).evaluateAll((buttons) =>
    buttons.map((button) => Math.round(button.getBoundingClientRect().right))
  );
  expect(new Set(lanes).size).toBe(1);
  // The thread's check sits beside its reply, not its top-level message.
  await expect(
    page.locator('[data-message="r1"] [data-thread-gutter] button')
  ).toHaveCount(1);
  await expect(
    page.locator('[data-message="m4"] [data-thread-gutter] button')
  ).toHaveAccessibleName(/Leo mentioned you/);

  await expect(page.getByRole('dialog')).toHaveCount(0);
  const rows = list(page).getByRole('listitem');
  await expect(rows).toHaveCount(3);
  // The docked list stays clear of the checks' lane.
  const listRight = await list(page).evaluate(
    (element) => element.getBoundingClientRect().right
  );
  expect(listRight).toBeLessThanOrEqual(Math.min(...lanes) - 28);

  await rows
    .filter({ hasText: 'Thread reply' })
    .getByRole('button')
    .first()
    .click();
  expect(await page.evaluate(() => window.opened)).toEqual(['m3/r1']);
});

test('a check marks its stack done and the list follows', async ({ page }) => {
  await open(page, 1600);
  await page
    .locator('[data-message="m2"] [data-thread-gutter]')
    .getByRole('button')
    .click();

  expect(await page.evaluate(() => window.marked)).toEqual([
    { kind: 'done', ids: ['n2', 'n1'] },
  ]);
  await expect(checks(page)).toHaveCount(2);
  await expect(list(page).getByRole('listitem')).toHaveCount(2);
  await expect(toggle(page)).toContainText('2');
});

test('Unread lists only unseen stacks and marks them read', async ({
  page,
}) => {
  await open(page, 1600);
  await list(page).getByText('Unread', { exact: true }).click();
  await expect(list(page).getByRole('radio', { name: 'Unread' })).toBeChecked();
  // The mention was seen: it is not done, but not unread either.
  const rows = list(page).getByRole('listitem');
  await expect(rows).toHaveCount(2);
  await expect(list(page)).not.toContainText('mentioned you');

  await rows.first().hover();
  await rows
    .first()
    .getByRole('button', { name: /^Mark read:/ })
    .click();
  expect(await page.evaluate(() => window.marked[0]?.kind)).toBe('read');
  await expect(rows).toHaveCount(1);
  // Reading leaves the stack's check: it is still not done.
  await expect(checks(page)).toHaveCount(3);
});

// A narrow split (140px of gutter): the list opens in a popover, and opening
// a stack from it closes the popover.
test('a narrow pane opens the list as a popover', async ({ page }) => {
  await open(page, 1200);
  await expect(list(page).getByRole('listitem')).toHaveCount(0);
  await expect(checks(page)).toHaveCount(3);

  await toggle(page).click();
  const popover = page.getByRole('dialog');
  await expect(popover.getByRole('listitem')).toHaveCount(3);
  await popover
    .getByRole('listitem')
    .filter({ hasText: 'mentioned you' })
    .getByRole('button')
    .first()
    .click();
  await expect(popover).toHaveCount(0);
  expect(await page.evaluate(() => window.opened)).toEqual(['m4']);
});

test('the gutter hides what no longer fits as the pane narrows', async ({
  page,
}) => {
  await open(page, 1600);
  await page.evaluate(() => window.setPaneWidth(1000));
  // 40px of gutter: no room for the toggle or the checks' 44px lane.
  await expect(toggle(page)).toHaveCount(0);
  await expect(checks(page).first()).toBeHidden();

  await page.evaluate(() => window.setPaneWidth(1600));
  await expect(toggle(page)).toBeVisible();
  await expect(checks(page).first()).toBeVisible();
});

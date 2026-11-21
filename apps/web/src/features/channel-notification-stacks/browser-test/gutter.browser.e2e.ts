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
  // Docked, the list is a filled card raised off the channel.
  await expect(list(page).locator('[data-slot="card"]')).toHaveAttribute(
    'data-variant',
    'filled'
  );
  // The docked list stays clear of the checks' lane.
  const listRight = await list(page).evaluate(
    (element) => element.getBoundingClientRect().right
  );
  expect(listRight).toBeLessThanOrEqual(Math.min(...lanes) - 28);

  // The toggle shows the notifications bell; marking keeps its checkmark.
  await expect(toggle(page).locator('svg')).toHaveAttribute(
    'data-macro-icon',
    'bell'
  );
  await expect(checks(page).first().locator('svg')).toHaveAttribute(
    'data-macro-icon',
    'check'
  );
  await expect(
    rows
      .first()
      .getByRole('button', { name: /^Mark done:/ })
      .locator('svg')
  ).toHaveAttribute('data-macro-icon', 'check');

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

test('a new notification keeps focus on the other stacks', async ({ page }) => {
  await open(page, 1600);
  const focusStays = async (target: ReturnType<Page['locator']>) => {
    await target.focus();
    await target.evaluate((element) => {
      (element as HTMLElement).dataset.probe = 'focused';
    });
    await page.evaluate(() =>
      window.notify(`n${window.marked.length + 10}-${Date.now()}`, 'm2')
    );
    await expect(page.locator('[data-probe="focused"]')).toBeFocused();
    await page.evaluate(() =>
      document.querySelector('[data-probe]')?.removeAttribute('data-probe')
    );
  };

  await focusStays(
    page.locator('[data-message="r1"] [data-thread-gutter] button')
  );
  await focusStays(
    list(page)
      .getByRole('listitem')
      .filter({ hasText: 'mentioned you' })
      .getByRole('button')
      .first()
  );
  await expect(toggle(page)).toContainText('3');
});

test('a failed read offers Retry instead of an empty list', async ({
  page,
}) => {
  await page.goto('/gutter.html?pane=1600&notDone=failed');
  await expect(list(page)).toContainText('Couldn’t load these notifications');
  await expect(list(page)).not.toContainText('Nothing left to mark done');
  await expect(list(page).getByRole('listitem')).toHaveCount(0);

  await list(page).getByRole('button', { name: 'Retry' }).click();
  // The list stays up and says it is loading until the retry answers.
  await expect(list(page)).toContainText('Loading…');
  await expect(list(page).getByRole('listitem')).toHaveCount(3);
});

test('unread dots follow unseen stacks on the toggle and the rows', async ({
  page,
}) => {
  await open(page, 1600);
  const toggleDot = toggle(page).locator('[data-unread-dot]');
  const rows = list(page).getByRole('listitem');
  const unreadDots = list(page).getByRole('img', { name: 'Unread' });

  // New messages and the thread hold unseen notifications; the mention was
  // seen, so it is not done but shows no dot.
  await expect(toggleDot).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-description', 'Unread');
  // In line after the count, centred with it.
  const count = await toggle(page)
    .getByText('3', { exact: true })
    .boundingBox();
  const dot = await toggleDot.boundingBox();
  if (!count || !dot) throw new Error('expected the count and the dot');
  expect(dot.x).toBeGreaterThan(count.x + count.width);
  expect(
    Math.abs(dot.y + dot.height / 2 - (count.y + count.height / 2))
  ).toBeLessThanOrEqual(1);
  await expect(rows).toHaveCount(3);
  await expect(unreadDots).toHaveCount(2);
  await expect(
    rows.filter({ hasText: 'mentioned you' }).getByRole('img', {
      name: 'Unread',
    })
  ).toHaveCount(0);

  // Every Unread row has its dot.
  await list(page).getByText('Unread', { exact: true }).click();
  await expect(rows).toHaveCount(2);
  await expect(unreadDots).toHaveCount(2);

  // Reading one stack takes its dot away; the toggle keeps its dot.
  const thread = rows.filter({ hasText: 'Thread reply' });
  await thread.hover();
  await thread.getByRole('button', { name: /^Mark read:/ }).click();
  await expect(rows).toHaveCount(1);
  await list(page).getByText('Not done', { exact: true }).click();
  await expect(rows).toHaveCount(3);
  await expect(unreadDots).toHaveCount(1);
  await expect(
    rows.filter({ hasText: 'Thread reply' }).getByRole('img', {
      name: 'Unread',
    })
  ).toHaveCount(0);
  await expect(toggleDot).toBeVisible();

  // With nothing unseen left, the toggle's dot goes too.
  await list(page).getByText('Unread', { exact: true }).click();
  await rows.first().hover();
  await rows
    .first()
    .getByRole('button', { name: /^Mark read:/ })
    .click();
  await expect(toggleDot).toHaveCount(0);
  await expect(toggle(page)).not.toHaveAttribute('aria-description', /./);
});

test('the toggle shows only while something is left to mark done', async ({
  page,
}) => {
  // Nothing while the not-done read loads: no flash of the bell.
  await page.goto('/gutter.html?pane=1600&notDone=loading');
  await expect(page.locator('[data-message="m1"]')).toBeVisible();
  await expect(toggle(page)).toHaveCount(0);
  await expect(list(page)).toHaveCount(0);

  await page.goto('/gutter.html?pane=1600&empty');
  await expect(page.locator('[data-message="m1"]')).toBeVisible();
  await expect(toggle(page)).toHaveCount(0);
  await expect(list(page)).toHaveCount(0);

  // A new notification brings the toggle and the docked card back.
  await page.evaluate(() => window.notify('n9', 'm2'));
  await expect(toggle(page)).toBeVisible();
  await expect(list(page).getByRole('listitem')).toHaveCount(1);

  // Marking the last stack done hides them again.
  await checks(page).first().click();
  await expect(toggle(page)).toHaveCount(0);
  await expect(list(page)).toHaveCount(0);
});

test('marking the last stacks done closes the popover', async ({ page }) => {
  await open(page, 1200);
  await toggle(page).click();
  const popover = page.getByRole('dialog');
  await popover.getByRole('button', { name: 'Mark all done' }).click();
  await expect(popover).toHaveCount(0);
  await expect(toggle(page)).toHaveCount(0);

  // It stays closed when a new notification brings the toggle back.
  await page.evaluate(() => window.notify('n9', 'm2'));
  await expect(toggle(page)).toBeVisible();
  await expect(popover).toHaveCount(0);
});

test('the popover stays closed when its toggle comes back', async ({
  page,
}) => {
  await open(page, 1200);
  await toggle(page).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  // Docked, then narrow again: the popover does not reopen by itself.
  await page.evaluate(() => window.resizeGutterPane(1600));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => window.resizeGutterPane(1200));
  await expect(toggle(page)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
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
  // The popover keeps the menu surface; only the docked list is a card.
  await expect(popover.locator('[data-slot="card"]')).toHaveCount(0);
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
  await page.evaluate(() => window.resizeGutterPane(1000));
  // 40px of gutter: no room for the toggle or the checks' 44px lane.
  await expect(toggle(page)).toHaveCount(0);
  await expect(checks(page).first()).toBeHidden();

  await page.evaluate(() => window.resizeGutterPane(1600));
  await expect(toggle(page)).toBeVisible();
  await expect(checks(page).first()).toBeVisible();
});

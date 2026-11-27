import { expect, type Page, test } from '@playwright/test';

const list = (page: Page) => page.locator('[data-channel-notification-list]');
const rows = (page: Page) => list(page).getByRole('listitem');
const toggle = (page: Page) =>
  page.getByRole('button', { name: 'Notifications in this channel' });
const row = (page: Page, text: string) => rows(page).filter({ hasText: text });
const checkOn = async (page: Page, text: string) => {
  await row(page, text).hover();
  await row(page, text)
    .getByRole('button', { name: /^Mark done:/ })
    .click();
};

async function open(page: Page, pane: number, query = '') {
  await page.goto(`/gutter.html?pane=${pane}${query}`);
  await expect(page.locator('[data-message="m1"]')).toBeVisible();
}

// A wide pane (340px of gutter): the list docked in the gutter, with no
// checks beside the messages and no view switch.
test('a wide pane docks the unread list', async ({ page }) => {
  await open(page, 1600);

  await expect(page.locator('[data-thread-gutter]')).toHaveCount(0);
  await expect(list(page).getByRole('radio')).toHaveCount(0);
  await expect(
    list(page).getByRole('heading', { name: 'Unread' })
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // The seen message is not listed; new messages, the thread and the mention are.
  await expect(rows(page)).toHaveCount(3);
  await expect(toggle(page)).toContainText('3');
  // Docked, the list is a filled card raised off the channel, inside the gutter.
  await expect(list(page).locator('[data-slot="card"]')).toHaveAttribute(
    'data-variant',
    'filled'
  );
  const listRight = await list(page).evaluate(
    (element) => element.getBoundingClientRect().right
  );
  const column = await page
    .locator('[data-message="m1"]')
    .evaluate((element) => element.getBoundingClientRect().left);
  expect(listRight).toBeLessThanOrEqual(column - 12);

  // The toggle shows the notifications bell; marking keeps its checkmark.
  await expect(toggle(page).locator('svg')).toHaveAttribute(
    'data-macro-icon',
    'bell'
  );
  await expect(
    rows(page)
      .first()
      .getByRole('button', { name: /^Mark done:/ })
      .locator('svg')
  ).toHaveAttribute('data-macro-icon', 'check');
});

test('clicking an entry opens its message and keeps it listed', async ({
  page,
}) => {
  await open(page, 1600);
  await row(page, 'Thread reply').getByRole('button').first().click();
  expect(await page.evaluate(() => window.opened)).toEqual(['m3/r1']);
  await expect(rows(page)).toHaveCount(3);
});

test('reading the messages leaves every entry listed', async ({ page }) => {
  await open(page, 1600);
  const unreadDots = list(page).getByRole('img', { name: 'Unread' });
  const toggleDot = toggle(page).locator('[data-unread-dot]');
  await expect(unreadDots).toHaveCount(3);
  await expect(toggleDot).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-description', 'Unread');

  await page.evaluate(() => window.read(['n2', 'n3']));
  await expect(rows(page)).toHaveCount(3);
  // Read entries lose their dot; the toggle keeps its own while one is unread.
  await expect(unreadDots).toHaveCount(1);
  await expect(toggleDot).toBeVisible();

  await page.evaluate(() => window.read(['n4']));
  await expect(rows(page)).toHaveCount(3);
  await expect(toggleDot).toHaveCount(0);
  await expect(toggle(page)).not.toHaveAttribute('aria-description', /./);
});

test('opening from a Home row lists what the row just read', async ({
  page,
}) => {
  await open(page, 1600, '&openedFromRow');
  await expect(rows(page)).toHaveCount(3);
  // Read by the row's click, so only the mention keeps its dot.
  await expect(list(page).getByRole('img', { name: 'Unread' })).toHaveCount(1);
});

test('the toggle dot sits after the count, centred with it', async ({
  page,
}) => {
  await open(page, 1600);
  const count = await toggle(page)
    .getByText('3', { exact: true })
    .boundingBox();
  const dot = await toggle(page).locator('[data-unread-dot]').boundingBox();
  if (!count || !dot) throw new Error('expected the count and the dot');
  expect(dot.x).toBeGreaterThan(count.x + count.width);
  expect(
    Math.abs(dot.y + dot.height / 2 - (count.y + count.height / 2))
  ).toBeLessThanOrEqual(1);
});

test('a check takes its entry off and marks its whole stack done', async ({
  page,
}) => {
  await open(page, 1600);
  await page.evaluate(() => window.read(['n2']));
  await checkOn(page, 'New message');

  // The seen message (n1) was never listed, but it is in the same stack.
  expect(await page.evaluate(() => window.marked)).toEqual([
    { ids: ['n2', 'n1'], ok: true },
  ]);
  await expect(rows(page)).toHaveCount(2);
  await expect(row(page, 'New message')).toHaveCount(0);
  await expect(toggle(page)).toContainText('2');
});

test('a failed mark puts the entry back', async ({ page }) => {
  await open(page, 1600);
  await page.evaluate(() => {
    window.failNextMark = true;
  });
  await checkOn(page, 'mentioned you');
  await expect(rows(page)).toHaveCount(2);
  await expect(row(page, 'mentioned you')).toHaveCount(1);
  await expect(rows(page)).toHaveCount(3);
  expect(await page.evaluate(() => window.marked)).toEqual([
    { ids: ['n4'], ok: false },
  ]);
});

test('replies and mentions that arrive are listed, new messages are not', async ({
  page,
}) => {
  await open(page, 1600);
  await page.evaluate(() => window.notify('late-message', 'message'));
  await page.evaluate(() => window.notify('late-reply', 'reply'));
  // The reply joins its thread's entry.
  await expect(row(page, 'Thread replies from Ana and Mara')).toHaveCount(1);
  await expect(row(page, 'New message from Leo')).toHaveCount(1);
  await expect(rows(page)).toHaveCount(3);

  // A mention read as it arrives (on screen) is listed too.
  await page.evaluate(() => {
    window.notify('late-mention', 'mention');
    window.read(['late-mention']);
  });
  await expect(rows(page)).toHaveCount(4);
  await expect(row(page, 'Ana mentioned you')).toHaveCount(1);
});

test('an arrival keeps focus on the other entries', async ({ page }) => {
  await open(page, 1600);
  const target = row(page, 'Leo mentioned you').getByRole('button').first();
  await target.focus();
  await target.evaluate((element) => {
    (element as HTMLElement).dataset.probe = 'focused';
  });
  await page.evaluate(() => window.notify('late-reply', 'reply'));
  await expect(row(page, 'Thread replies')).toHaveCount(1);
  await expect(page.locator('[data-probe="focused"]')).toBeFocused();
});

test('the toggle hides after the last entry and returns with a reply', async ({
  page,
}) => {
  await open(page, 1600);
  await list(page).getByRole('button', { name: 'Mark all done' }).click();
  await expect(toggle(page)).toHaveCount(0);
  await expect(list(page)).toHaveCount(0);

  await page.evaluate(() => window.notify('late-reply', 'reply'));
  await expect(toggle(page)).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
});

test('reopening the channel takes a fresh list', async ({ page }) => {
  await open(page, 1600);
  await page.evaluate(() => window.read(['n2', 'n3', 'n4']));
  await expect(rows(page)).toHaveCount(3);

  await page.evaluate(() => window.reopen());
  await expect(page.locator('[data-message="m1"]')).toBeVisible();
  await expect(toggle(page)).toHaveCount(0);

  // A new top-level message is unread at the next open, so it is listed then.
  await page.evaluate(() => window.notify('late-message', 'message'));
  await expect(toggle(page)).toHaveCount(0);
  await page.evaluate(() => window.reopen());
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, 'New message from Ana')).toHaveCount(1);
});

test('moving the channel keeps its list', async ({ page }) => {
  await open(page, 1600);
  await page.evaluate(() => window.read(['n2', 'n3', 'n4']));
  await page.evaluate(() => window.remount());
  await expect(page.locator('[data-message="m1"]')).toBeVisible();
  await expect(rows(page)).toHaveCount(3);
});

test('a failed read offers Retry, then lists', async ({ page }) => {
  await open(page, 1600, '&notDone=failed');
  await expect(list(page)).toContainText('Couldn’t load these notifications');
  await expect(rows(page)).toHaveCount(0);

  await list(page).getByRole('button', { name: 'Retry' }).click();
  // The list stays up and says it is loading until the retry answers.
  await expect(list(page)).toContainText('Loading…');
  await expect(rows(page)).toHaveCount(3);
});

test('nothing shows while loading or with nothing unread', async ({ page }) => {
  await open(page, 1600, '&notDone=loading');
  await expect(toggle(page)).toHaveCount(0);
  await expect(list(page)).toHaveCount(0);

  await open(page, 1600, '&empty');
  await expect(toggle(page)).toHaveCount(0);
  await expect(list(page)).toHaveCount(0);
});

test('marking the last entries done closes the popover', async ({ page }) => {
  await open(page, 1200);
  await toggle(page).click();
  const popover = page.getByRole('dialog');
  await popover.getByRole('button', { name: 'Mark all done' }).click();
  await expect(popover).toHaveCount(0);
  await expect(toggle(page)).toHaveCount(0);

  // It stays closed when a reply brings the toggle back.
  await page.evaluate(() => window.notify('late-reply', 'reply'));
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
// an entry from it closes the popover.
test('a narrow pane opens the list as a popover', async ({ page }) => {
  await open(page, 1200);
  await expect(rows(page)).toHaveCount(0);

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

test('the toggle hides when the gutter has no room', async ({ page }) => {
  await open(page, 1600);
  await page.evaluate(() => window.resizeGutterPane(1000));
  // 40px of gutter: no room for the toggle.
  await expect(toggle(page)).toHaveCount(0);

  await page.evaluate(() => window.resizeGutterPane(1600));
  await expect(toggle(page)).toBeVisible();
});

// Long sender names and addresses wrap inside the row, two lines at most,
// docked and in the popover: nothing runs past the card or scrolls sideways.
for (const { name, pane } of [
  { name: 'docked', pane: 1600 },
  { name: 'popover', pane: 1200 },
]) {
  test(`long sender labels stay inside the ${name} list`, async ({ page }) => {
    await page.goto(`/gutter.html?pane=${pane}&names=long`);
    await expect(page.locator('[data-message="m1"]')).toBeVisible();
    if (name === 'popover') await toggle(page).click();
    const surface =
      name === 'docked'
        ? list(page).locator('[data-slot="card"]')
        : page.getByRole('dialog');
    const rows = surface.getByRole('listitem');
    await expect(rows).toHaveCount(3);

    const layout = await surface.evaluate((element) => {
      const overflowing = (target: Element) =>
        target.scrollWidth > target.clientWidth;
      const scroller = element.querySelector('ul')?.parentElement;
      const box = element.getBoundingClientRect();
      return {
        surface: overflowing(element) || (!!scroller && overflowing(scroller)),
        rows: [...element.querySelectorAll('li')].map((row) => {
          const button = row.querySelector('button');
          const [lead, label] = button?.children ?? [];
          if (!button || !lead || !label) throw new Error('expected a row');
          return {
            overflow: [row, button, label].some(overflowing),
            insideRight: label.getBoundingClientRect().right <= box.right,
            // Unread dot and kind icon stay on the first line.
            leadOffset: Math.abs(
              lead.getBoundingClientRect().top -
                label.getBoundingClientRect().top
            ),
            lines: Math.round(label.clientHeight / 18),
          };
        }),
      };
    });
    expect(layout.surface).toBe(false);
    for (const row of layout.rows) {
      expect(row.overflow).toBe(false);
      expect(row.insideRight).toBe(true);
      expect(row.leadOffset).toBeLessThanOrEqual(1);
      expect(row.lines).toBeLessThanOrEqual(2);
    }

    // The check on a long row stays inside the surface.
    const row = rows.filter({ hasText: 'mentioned you' });
    await row.hover();
    const check = await row
      .getByRole('button', { name: /^Mark done:/ })
      .boundingBox();
    const box = await surface.boundingBox();
    if (!check || !box) throw new Error('expected the check and the surface');
    expect(check.x + check.width).toBeLessThanOrEqual(box.x + box.width);

    // A clamped label shows the whole of it in a tooltip.
    await expect(page.getByRole('tooltip')).toContainText(
      'Leopold Maximilian Fairweather-Huntington of the Northern Planning Office mentioned you'
    );
  });
}

test('a label that fits shows no tooltip', async ({ page }) => {
  await open(page, 1600);
  await list(page)
    .getByRole('listitem')
    .filter({ hasText: 'mentioned you' })
    .getByText('Leo mentioned you')
    .hover();
  // Past the tooltip's open delay.
  await page.waitForTimeout(800);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
});

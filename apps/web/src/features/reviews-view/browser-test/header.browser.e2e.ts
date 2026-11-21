import { expect, type Page, test } from '@playwright/test';

const fixture = '/src/features/reviews-view/browser-test/header.html';

async function open(page: Page, query = '') {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let ownerless = 0;
  // Solid's warning for computations nobody disposes, e.g. made from a timer.
  page.on('console', (message) => {
    if (message.text().includes('computations created outside')) ownerless++;
  });
  await page.setViewportSize({ width: 1400, height: 600 });
  await page.goto(`${fixture}?width=1200${query}`, {
    waitUntil: 'networkidle',
  });
  await expect.poll(() => header(page)).toMatchObject({ overflow: 0 });
  // Modules warn as they load; the header must add none while it works.
  const loaded = ownerless;
  return {
    problems: () => [
      ...errors,
      ...(ownerless > loaded ? [`${ownerless - loaded} ownerless`] : []),
    ],
  };
}

const resize = (page: Page, width: number) =>
  page
    .getByTestId('pane')
    .evaluate((pane, value) => (pane.style.width = `${value}px`), width);

/** What the header shows, once it has settled. */
const header = (page: Page) =>
  page.evaluate(() => {
    const row = document.querySelector('[data-view-shell-top-bar]')!
      .lastElementChild as HTMLElement;
    const label = [...document.querySelectorAll('[role=radiogroup] span')].find(
      (span) => span.textContent?.trim() === 'Open'
    );
    const scope = [...document.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Involves me'
    );
    const tabs = !label
      ? 'none'
      : label.getBoundingClientRect().width > 4
        ? 'labelled'
        : 'icons';
    return {
      tabs,
      scope: (scope?.getBoundingClientRect().width ?? 0) > 0,
      overflow: row.scrollWidth - row.clientWidth,
    };
  });

async function expectHeader(
  page: Page,
  expected: { tabs: string; scope: boolean }
) {
  await expect.poll(() => header(page)).toEqual({ ...expected, overflow: 0 });
  await expect(page.getByRole('button', { name: 'New' })).toBeInViewport({
    ratio: 1,
  });
}

test('keeps the status tabs labelled and the scope shown while the actions fit', async ({
  page,
}) => {
  const watch = await open(page);
  await expectHeader(page, { tabs: 'labelled', scope: true });
  await expect(
    page.getByRole('button', { name: 'Search reviews' })
  ).toBeInViewport({ ratio: 1 });
  expect(watch.problems()).toEqual([]);
});

test('gives up tab labels, then the scope name, only as far as the actions need, and takes them back', async ({
  page,
}) => {
  const watch = await open(page);
  const steps = [
    { width: 760, tabs: 'labelled', scope: true },
    { width: 620, tabs: 'icons', scope: true },
    { width: 460, tabs: 'icons', scope: false },
    { width: 620, tabs: 'icons', scope: true },
    { width: 760, tabs: 'labelled', scope: true },
  ];
  for (const step of steps) {
    await resize(page, step.width);
    await expectHeader(page, { tabs: step.tabs, scope: step.scope });
    await expect(
      page.getByRole('button', { name: 'Search reviews' })
    ).toBeInViewport({ ratio: 1 });
    // Settled, not flipping between the two.
    await page.waitForTimeout(300);
    expect((await header(page)).tabs).toBe(step.tabs);
  }
  expect(watch.problems()).toEqual([]);
});

test('icon-only status tabs keep their names, tooltips and distinct icons', async ({
  page,
}) => {
  await open(page);
  await resize(page, 620);
  await expectHeader(page, { tabs: 'icons', scope: true });

  const names = ['Open', 'Closed', 'All'];
  const icons = await Promise.all(
    names.map((name) =>
      page
        .getByRole('radio', { name })
        .locator('xpath=ancestor::*[@role="group"][1]')
        .locator('svg')
        .evaluate((svg) => svg.innerHTML)
    )
  );
  expect(new Set(icons).size).toBe(3);

  await page.getByRole('radio', { name: 'Closed' }).locator('..').hover();
  await expect(page.getByRole('tooltip')).toHaveText('Closed');

  await page.getByRole('radio', { name: 'Closed' }).locator('..').click();
  await expect(page.getByRole('radio', { name: 'Closed' })).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'All' })).toBeChecked();
});

test('an open search that would not fit takes the tab labels, and closing gives them back', async ({
  page,
}) => {
  await open(page);
  await resize(page, 710);
  await expectHeader(page, { tabs: 'labelled', scope: true });

  await page.getByRole('button', { name: 'Search reviews' }).click();
  await expect(
    page.getByRole('searchbox', { name: 'Search reviews' })
  ).toBeFocused();
  await expectHeader(page, { tabs: 'icons', scope: true });
  await expect(
    page.getByRole('button', { name: 'Close search' })
  ).toBeInViewport({ ratio: 1 });

  await page.getByRole('button', { name: 'Close search' }).click();
  await expectHeader(page, { tabs: 'labelled', scope: true });
});

test('on the board, with no status tabs, only the scope name makes room', async ({
  page,
}) => {
  const watch = await open(page, '&board');
  await expectHeader(page, { tabs: 'none', scope: true });
  await resize(page, 360);
  await expectHeader(page, { tabs: 'none', scope: false });
  await resize(page, 760);
  await expectHeader(page, { tabs: 'none', scope: true });
  expect(watch.problems()).toEqual([]);
});

test('switching between list and board keeps the header settled', async ({
  page,
}) => {
  const watch = await open(page);
  await resize(page, 460);
  await expectHeader(page, { tabs: 'icons', scope: false });
  await page.getByRole('button', { name: 'Toggle board' }).click();
  await expectHeader(page, { tabs: 'none', scope: true });
  await page.getByRole('button', { name: 'Toggle board' }).click();
  await expectHeader(page, { tabs: 'icons', scope: false });
  await expect(
    page.getByRole('button', { name: 'Search reviews' })
  ).toBeInViewport({ ratio: 1 });
  expect(watch.problems()).toEqual([]);
});

test('tabs that first appear short of room get their labels back once there is room', async ({
  page,
}) => {
  const watch = await open(page, '&board');
  await resize(page, 360);
  await expectHeader(page, { tabs: 'none', scope: false });
  await page.getByRole('button', { name: 'Toggle board' }).click();
  // Too narrow for the list even with everything given up.
  await expect
    .poll(async () => {
      const { tabs, scope } = await header(page);
      return { tabs, scope };
    })
    .toEqual({ tabs: 'icons', scope: false });
  await resize(page, 1200);
  await expectHeader(page, { tabs: 'labelled', scope: true });
  expect(watch.problems()).toEqual([]);
});

test('a status that changes the room keeps keyboard focus on the status', async ({
  page,
}) => {
  const watch = await open(page);
  // Find the narrowest width where Open, whose filter count widens the
  // filter button, still has labels; one step narrower it has icons.
  let width = 760;
  await resize(page, width);
  await expectHeader(page, { tabs: 'labelled', scope: true });
  while ((await header(page)).tabs === 'labelled' && width > 560) {
    width -= 2;
    await resize(page, width);
    await page.waitForTimeout(150);
  }
  await expectHeader(page, { tabs: 'icons', scope: true });

  // All has no filter count, so the labels fit again, under the keyboard.
  await page.getByRole('radio', { name: 'Open' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Closed' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'All' })).toBeChecked();
  await expectHeader(page, { tabs: 'labelled', scope: true });
  await expect(page.getByRole('radio', { name: 'All' })).toBeFocused();

  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('radio', { name: 'Closed' })).toBeChecked();
  await expectHeader(page, { tabs: 'icons', scope: true });
  await expect(page.getByRole('radio', { name: 'Closed' })).toBeFocused();
  expect(watch.problems()).toEqual([]);
});

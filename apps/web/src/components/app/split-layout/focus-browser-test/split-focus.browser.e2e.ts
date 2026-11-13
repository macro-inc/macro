import { expect, type Page, test } from '@playwright/test';

const pane = (page: Page, name: string) =>
  page.locator(`[data-pane="${name}"]`);

const call = (page: Page, run: string) =>
  page.evaluate(`window.splitFocus.${run}`);

// Focus is in the pane, and the pane is the active split.
async function expectFocused(page: Page, name: string) {
  await expect(pane(page, name)).toHaveAttribute('data-active', 'true');
  await expect
    .poll(() =>
      page.evaluate(
        (paneName) =>
          document
            .querySelector(`[data-pane="${paneName}"]`)
            ?.contains(document.activeElement) ?? false,
        name
      )
    )
    .toBe(true);
}

// Two splits stacked on the left, three on the right.
async function openTwoBesideThree(page: Page, left = 'l2') {
  await page.goto('/');
  await expect(pane(page, 'l1')).toBeVisible();
  await call(page, `open(${JSON.stringify(left)}, 'l1')`);
  await call(page, `open('r1')`);
  await call(page, `open('r2', 'r1')`);
  await call(page, `open('r3', 'r2')`);
  await expect(pane(page, 'r3')).toBeVisible();
}

test('Shift+J/K and Shift+Up/Down move between stacked splits, and back to the one you came from', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openTwoBesideThree(page);

  await call(page, `activate('r1')`);
  await expectFocused(page, 'r1');

  await page.keyboard.press('Shift+J');
  await expectFocused(page, 'r2');
  await page.keyboard.press('Shift+ArrowDown');
  await expectFocused(page, 'r3');
  await page.keyboard.press('Shift+J');
  await expectFocused(page, 'r1');
  await page.keyboard.press('Shift+K');
  await expectFocused(page, 'r3');
  await page.keyboard.press('Shift+ArrowUp');
  await expectFocused(page, 'r2');

  // The centre of r2 is level with the line between l1 and l2: the upper wins,
  // and going back right returns to r2 rather than r1 beside l1's centre.
  await page.keyboard.press('Shift+H');
  await expectFocused(page, 'l1');
  await page.keyboard.press('Shift+L');
  await expectFocused(page, 'r2');

  // From l2, r2 is beside it and was active last: back there, not to r3 level
  // with l2's centre.
  await call(page, `activate('l2')`);
  await page.keyboard.press('Shift+ArrowRight');
  await expectFocused(page, 'r2');
  await page.keyboard.press('Shift+ArrowDown');
  await expectFocused(page, 'r3');
  await page.keyboard.press('Shift+ArrowLeft');
  await expectFocused(page, 'l2');
  expect(errors).toEqual([]);
});

test('a list keeps Shift+Up/Down for its selection, and Shift+J/K still move splits', async ({
  page,
}) => {
  await openTwoBesideThree(page, 'list');
  const list = pane(page, 'list');
  await call(page, `activate('list')`);
  await list.getByRole('button', { name: 'List row' }).focus();
  await expectFocused(page, 'list');

  await page.keyboard.press('Shift+ArrowDown');
  await expect(list.locator('[data-extended]')).toHaveAttribute(
    'data-extended',
    '1'
  );
  await expectFocused(page, 'list');

  await page.keyboard.press('Shift+K');
  await expectFocused(page, 'l1');
});

test('a database grid keeps Shift+Arrow, and a text field keeps its selection keys', async ({
  page,
}) => {
  await openTwoBesideThree(page, 'grid');
  const grid = page.getByRole('grid');
  await call(page, `activate('grid')`);
  await grid.focus();

  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(grid).toHaveAttribute('data-ranged', '2');
  await expectFocused(page, 'grid');

  await page.keyboard.press('Shift+K');
  await expectFocused(page, 'l1');

  const draft = pane(page, 'l1').getByRole('textbox');
  await draft.fill('one\ntwo');
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('Shift+J');
  await expect(draft).toHaveValue('oneJ');
  await expectFocused(page, 'l1');
});

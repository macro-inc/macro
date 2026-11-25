import { expect, type Page, test } from '@playwright/test';

/**
 * On wide touch (an unfolded foldable, a tablet) a titled view heads its left
 * pane with its name and a control that collapses the pane, so the open item
 * takes the width; the open item's first island brings the pane back.
 */

test.use({ hasTouch: true });

const FIXTURE = '/src/components/view-shell/browser-test/touch-sidebar.html';

const hide = (page: Page) =>
  page.getByRole('button', { name: 'Hide side pane' });
const show = (page: Page) =>
  page.getByRole('button', { name: 'Show side pane' });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 844 });
});

test('a collection list collapses beside an open item and comes back', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto(`${FIXTURE}?workspace`);
  const listFrame = page.locator('[data-view-shell-list]');
  const detail = page.locator('[data-view-shell-detail]');
  const title = listFrame.locator('[data-view-shell-left-pane-title]');
  await expect(title).toHaveText('Items');
  // The row takes the safe area and the list's own controls start below it.
  const titleBox = (await title.boundingBox())!;
  expect(titleBox.y).toBe(0);
  expect(titleBox.height).toBe(24 + 48);
  const listHeader = (await listFrame
    .locator('[data-mobile-list-header]')
    .boundingBox())!;
  expect(listHeader.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);

  // With nothing open the list holds the only next step: it stays.
  await expect(hide(page)).toHaveCount(0);

  await page.locator('[data-workspace-row="3"]').tap();
  const draft = page.getByRole('textbox', { name: 'Preview draft' });
  await draft.fill('Keep this draft');
  await hide(page).tap();
  await expect(listFrame).toBeHidden();
  expect((await detail.boundingBox())!.x).toBe(0);
  expect((await detail.boundingBox())!.width).toBe(1000);
  await expect(draft).toHaveValue('Keep this draft');

  // Show side pane leads the item's top bar.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const expand = document.querySelector(
          '[data-view-shell-left-pane-toggle="expand"]'
        );
        const heading = [
          ...document.querySelectorAll('[data-view-shell-top-bar] span'),
        ].find((element) => element.textContent === 'Preview 3');
        if (!expand || !heading) return false;
        return (
          expand.getBoundingClientRect().right <=
          heading.getBoundingClientRect().left
        );
      })
    )
    .toBe(true);

  // The choice is saved for the view.
  await page.reload();
  await page.locator('[data-workspace-row="3"]').tap();
  await expect(listFrame).toBeHidden();
  await show(page).tap();
  await expect(listFrame).toBeVisible();
  expect((await listFrame.boundingBox())!.width).toBe(403);
  await expect(hide(page)).toBeVisible();
  await expect(show(page)).toHaveCount(0);
});

test('a collapsed collection list returns when nothing is open', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto(`${FIXTURE}?workspace`);
  const listFrame = page.locator('[data-view-shell-list]');
  await page.locator('[data-workspace-row="1"]').tap();
  await hide(page).tap();
  await expect(listFrame).toBeHidden();
  // The open item goes away, as when it's archived or deleted.
  await page.getByRole('button', { name: 'Close preview' }).tap();
  await expect(listFrame).toBeVisible();
  await expect(page.locator('[data-view-shell-detail]')).toContainText(
    'Select an item to preview'
  );
});

test('a docked list aside collapses beside an open conversation and comes back', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto(`${FIXTURE}?channels`);
  const navigation = page.getByRole('complementary', {
    name: 'Chat navigation',
  });
  const aside = page.locator('[data-view-shell-aside]');
  await expect(aside.locator('[data-view-shell-left-pane-title]')).toHaveText(
    'Chat'
  );
  await expect(hide(page)).toHaveCount(0);

  await navigation
    .getByRole('button', { name: 'Conversation 2', exact: true })
    .tap();
  const preview = page.getByTestId('channel-preview');
  await expect(preview).toHaveText('Conversation 2 preview');
  await hide(page).tap();
  await expect(navigation).toBeHidden();
  // Measured together: the conversation widens as the aside leaves.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const expand = document.querySelector(
          '[data-view-shell-left-pane-toggle="expand"]'
        );
        const menu = [...document.querySelectorAll('button')].find(
          (button) => button.textContent === 'Channel menu'
        );
        if (!expand || !menu) return false;
        return (
          expand.getBoundingClientRect().right <=
          menu.getBoundingClientRect().left
        );
      })
    )
    .toBe(true);
  await show(page).tap();
  await expect(navigation).toBeVisible();
  await expect(preview).toHaveText('Conversation 2 preview');
});

test('folded, the left pane has no title row or collapse control', async ({
  page,
}) => {
  await page.setViewportSize({ width: 466, height: 678 });
  await page.goto(`${FIXTURE}?workspace`);
  await expect(page.locator('[data-workspace-row="0"]')).toBeVisible();
  await expect(page.locator('[data-view-shell-left-pane-title]')).toHaveCount(
    0
  );
  await page.locator('[data-workspace-row="0"]').tap();
  await expect(hide(page)).toHaveCount(0);
  await expect(show(page)).toHaveCount(0);
});

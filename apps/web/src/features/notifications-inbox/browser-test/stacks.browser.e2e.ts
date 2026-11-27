import { expect, type Page, test } from '@playwright/test';
import { stayLocal } from './stay-local';

const PAGE =
  '/src/features/notifications-inbox/browser-test/notifications-view.html';

const STACK_ID = 'dm-stack';
const ROW_IDS = ['dm-ana', 'dm-leo', 'dm-mara'];

async function openInbox(page: Page) {
  await stayLocal(page);
  await page.goto(PAGE);
  // The first load pre-bundles the app's dependencies.
  await expect(page.locator(`#${STACK_ID}`)).toBeVisible({ timeout: 180_000 });
}

const opacityOf = (page: Page, id: string) =>
  page
    .locator(`#${id}`)
    .evaluate((row) => Number(getComputedStyle(row).opacity));

test.describe('desktop', () => {
  test.use({ viewport: { width: 1100, height: 700 } });

  test("a stack folds from where it unfolded, and from its last notification's Hide", async ({
    page,
  }) => {
    await openInbox(page);
    const stack = page.locator(`#${STACK_ID}`);
    const toggle = stack.getByRole('button', { name: /2 notifications/ });
    await expect(toggle).toHaveText('1 more');
    const folded = await toggle.boundingBox();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveText('Hide');
    // Where the pointer already is, so it folds without moving.
    const open = await toggle.boundingBox();
    expect(open?.x).toBe(folded?.x);
    expect(open?.y).toBe(folded?.y);
    const bottom = page
      .locator('[data-stack-item]')
      .getByRole('button', { name: /2 notifications/ });
    await expect(bottom).toHaveText('Hide');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-stack-item]')).toHaveCount(0);

    await toggle.click();
    await bottom.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-stack-item]')).toHaveCount(0);
  });

  test("Mark done takes the time's place on hover, and nothing moves", async ({
    page,
  }) => {
    await openInbox(page);
    const row = page.locator('#dm-leo');
    const time = row.locator('[data-card-time]');
    const done = row.getByRole('button', { name: 'Mark done' });
    const restingTime = await time.boundingBox();
    const restingWho = await row.locator('[data-card-who]').boundingBox();
    await expect(time).toBeVisible();
    await expect(done).toBeHidden();

    await row.hover();

    await expect(done).toBeVisible();
    await expect(time.locator('span').first()).toHaveCSS(
      'visibility',
      'hidden'
    );
    expect(await time.boundingBox()).toEqual(restingTime);
    expect(await row.locator('[data-card-who]').boundingBox()).toEqual(
      restingWho
    );
    // The check sits over the time, ending where it does.
    const button = await done.boundingBox();
    const glyph = await done.locator('svg').boundingBox();
    if (!restingTime || !button || !glyph) throw new Error('not laid out');
    expect(button.y).toBeLessThan(restingTime.y);
    expect(button.y + button.height).toBeGreaterThan(
      restingTime.y + restingTime.height
    );
    expect(
      Math.abs(glyph.x + glyph.width - (restingTime.x + restingTime.width))
    ).toBeLessThanOrEqual(3);

    await done.click();
    await expect(row).toHaveCount(0);
  });

  test('an open stack leaves the other rows as they are', async ({ page }) => {
    await openInbox(page);
    await page
      .locator(`#${STACK_ID}`)
      .getByRole('button', { name: /2 notifications/ })
      .click();
    await expect(page.locator('[data-stack-item]')).toHaveCount(2);
    // Away from every row, so none is hovered.
    await page.mouse.move(900, 650);

    for (const id of ROW_IDS) expect(await opacityOf(page, id)).toBe(1);
  });
});

test.describe('phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test('an open stack leaves the other rows as they are', async ({ page }) => {
    await openInbox(page);
    const toggle = page
      .locator(`#${STACK_ID}`)
      .getByRole('button', { name: /2 notifications/ });
    // A phone's caret has no count and no bottom Hide.
    await expect(toggle).toHaveText('');

    await toggle.tap();

    await expect(page.locator('[data-stack-item]')).toHaveCount(2);
    await expect(
      page.getByRole('button', { name: /2 notifications/ })
    ).toHaveCount(1);
    for (const id of ROW_IDS) expect(await opacityOf(page, id)).toBe(1);
  });
});

import { expect, type Page, test } from '@playwright/test';

// Team libraries (`?libraries`): `design-system.fig` as the library and a
// blank design using it, both kept in memory (saves replace them, as
// document storage does). The library is published, enabled in the other
// design, its components and styles used there, changed and published
// again, and the copies updated.

async function openFixture(page: Page) {
  await page.goto('/?libraries');
  await expect(page.getByTestId('fig-viewer')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.figFixture.libraries?.current()))
    .toBe('design-system');
}

/** Opens a design kept in memory, once what was open is saved. */
async function openDesign(page: Page, id: string) {
  await page.getByTestId(`fig-fixture-open-${id}`).click();
  await expect
    .poll(() => page.evaluate(() => window.figFixture.libraries?.current()))
    .toBe(id);
  await expect(page.getByTestId('fig-viewer')).toBeVisible();
}

async function waitForSave(page: Page, before: number) {
  await expect
    .poll(() => page.evaluate(() => window.figFixture.saves().length), {
      timeout: 15_000,
    })
    .toBeGreaterThan(before);
}

const saves = (page: Page) =>
  page.evaluate(() => window.figFixture.saves().length);

async function assetsTab(page: Page) {
  await page.getByTestId('fig-tab-assets').click();
  await expect(page.getByTestId('fig-assets')).toBeVisible();
}

async function publish(page: Page, note: string) {
  await assetsTab(page);
  await page.getByTestId('fig-assets-libraries').click();
  await page.getByTestId('fig-library-publish').click();
  const dialog = page.getByTestId('fig-publish-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('fig-publish-change').first()).toBeVisible();
  await page.getByTestId('fig-publish-note').fill(note);
  const before = await saves(page);
  await page.getByTestId('fig-publish-confirm').click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => window.figFixture.notices()))
    .toContain('Library published');
  await waitForSave(page, before);
}

/** The fill of the first layer in the selected instance (`RRGGBB`). */
const instanceBackground = (page: Page) =>
  page.evaluate(async () => {
    const engine = window.figFixture.engine();
    if (!engine) return null;
    const uses = await engine.libraryUses();
    const card = uses.copies.find((c) => c.name === 'Card');
    const page0 = (await engine.layers(0)).find((r) => r.type === 'INSTANCE');
    if (!card || !page0) return null;
    const background = (await engine.layers(0, page0.id)).find(
      (r) => r.name === 'Background'
    );
    if (!background) return null;
    const info = await engine.nodeInfo(0, background.id);
    return info.fills[0]?.color ?? null;
  });

test('publishes a library, uses it in another design, and updates it', async ({
  page,
}) => {
  await openFixture(page);
  await publish(page, 'First version');

  // The other design turns the library on and places a Card from it.
  await openDesign(page, 'app');
  await assetsTab(page);
  await page.getByTestId('fig-assets-libraries').click();
  const dialog = page.getByTestId('fig-libraries-dialog');
  const row = dialog
    .getByTestId('fig-library-row')
    .filter({ hasText: 'Design system' });
  await expect(row).toContainText('assets');
  await row.getByTestId('fig-library-toggle').click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  const section = page
    .getByTestId('fig-library-assets')
    .filter({ hasText: 'Design system' });
  await expect(section).toBeVisible();
  await page.getByTestId('fig-assets-search').fill('Card');
  const beforeInsert = await saves(page);
  const card = section
    .getByTestId('fig-library-asset')
    .filter({ hasText: 'Card' });
  await card.first().click();
  await expect
    .poll(() => instanceBackground(page), { timeout: 10_000 })
    .toBe('F1F4F9');
  const uses = await page.evaluate(async () =>
    window.figFixture.engine()?.libraryUses()
  );
  expect(uses?.enabled.map((l) => l.name)).toEqual(['Design system']);
  expect(uses?.copies.find((c) => c.name === 'Card')?.library).toBe(
    'design-system'
  );
  // Copies stay off the pages' assets: the local list is empty.
  await page.getByTestId('fig-assets-search').fill('');
  await expect(page.getByTestId('fig-asset')).toHaveCount(0);
  await waitForSave(page, beforeInsert);

  // The library changes the card's background and publishes again.
  const savedApp = await saves(page);
  await openDesign(page, 'design-system');
  await page.getByTestId('fig-tab-layers').click();
  await page.getByTestId('fig-page').filter({ hasText: 'Components' }).click();
  await expect(
    page.getByTestId('fig-layer-row').filter({ hasText: 'Card' })
  ).toBeVisible();
  await page.getByTestId('fig-layer-search').fill('Background');
  await page
    .getByTestId('fig-search-hit')
    .filter({ has: page.getByText('Background', { exact: true }) })
    .first()
    .click();
  await page.getByTestId('fig-layer-search').fill('');
  await expect(page.getByTestId('fig-fill-0-hex')).toHaveValue('F1F4F9');
  await page.getByTestId('fig-fill-0-hex').fill('FF0000');
  await page.getByTestId('fig-fill-0-hex').press('Enter');
  await publish(page, 'Red cards');
  expect(await saves(page)).toBeGreaterThan(savedApp);

  // Back in the design using it: updates are offered and applied.
  await openDesign(page, 'app');
  const notice = page.getByTestId('fig-library-updates');
  await expect(notice).toBeVisible({ timeout: 15_000 });
  await expect(notice).toContainText('1 component');
  await page.getByTestId('fig-library-updates-review').click();
  const review = page.getByTestId('fig-library-review');
  await expect(review).toContainText('Red cards');
  await expect(review.getByTestId('fig-library-update')).toHaveCount(1);
  await expect(review.getByTestId('fig-library-update')).toContainText('Card');
  await page.getByTestId('fig-library-update-all').click();
  await expect(review).toBeHidden();
  await expect.poll(() => instanceBackground(page)).toBe('FF0000');
  await expect(notice).toBeHidden();

  // Undo puts the old version back (and offers the update again).
  await page.getByTestId('fig-canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => instanceBackground(page)).toBe('F1F4F9');
  await expect(notice).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.figFixture.errors()))
    .toEqual([]);
});

test('applies a library style and drags in a component', async ({ page }) => {
  await openFixture(page);
  await publish(page, '');
  await openDesign(page, 'app');
  await assetsTab(page);
  await page.getByTestId('fig-assets-libraries').click();
  await page
    .getByTestId('fig-library-row')
    .filter({ hasText: 'Design system' })
    .getByTestId('fig-library-toggle')
    .click();
  await page.keyboard.press('Escape');

  // Drag a component onto the canvas.
  const section = page
    .getByTestId('fig-library-assets')
    .filter({ hasText: 'Design system' });
  const star = section
    .getByTestId('fig-library-asset')
    .filter({ hasText: 'Star' })
    .first();
  await expect(star).toBeVisible();
  await star.dragTo(page.getByTestId('fig-canvas'), {
    targetPosition: { x: 400, y: 300 },
  });
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await window.figFixture.engine()?.layers(0))?.map((r) => r.type)
      )
    )
    .toEqual(['INSTANCE']);

  // Draw a rectangle and give it the library's color style.
  const canvas = page.getByTestId('fig-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  await canvas.click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('r');
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 160, { steps: 4 });
  await page.mouse.up();
  await page.getByTestId('fig-tab-assets').click();
  await section
    .getByTestId('fig-library-asset')
    .filter({ hasText: 'Brand/Primary' })
    .click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const engine = window.figFixture.engine();
        const rows = (await engine?.layers(0)) ?? [];
        const rect = rows.find((r) => r.type === 'RECTANGLE');
        if (!engine || !rect) return null;
        return (await engine.nodeInfo(0, rect.id)).fills[0]?.color ?? null;
      })
    )
    .toBe('7B61FF');
  await expect
    .poll(() => page.evaluate(() => window.figFixture.errors()))
    .toEqual([]);
});

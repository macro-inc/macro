import { expect, test } from '@playwright/test';

test('shares a component lock and unlock between editors', async ({ page }) => {
  await page.setViewportSize({ width: 2000, height: 900 });
  await page.goto('/?collab&people=alice,bob&file=showcase.fig');
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.figFixture?.collab
          ?.people()
          .every((person) => person.engine() && person.peers().length > 0)
      )
    )
    .toBe(true);
  for (const name of ['Alice', 'Bob']) {
    const editor = page.getByTestId(`fig-person-${name}`);
    await editor
      .getByRole('button', { name: 'Find layers', exact: true })
      .click();
    await editor
      .getByRole('searchbox', { name: 'Find layers' })
      .fill('Primary button');
    await editor
      .getByTestId('fig-search-hit')
      .filter({ hasText: /^Primary button$/ })
      .click();
    await editor.getByRole('button', { name: 'Close search' }).click();
  }
  const alice = page
    .getByTestId('fig-person-Alice')
    .getByTestId('fig-layer-row')
    .filter({ hasText: /^Primary button$/ });
  const bob = page
    .getByTestId('fig-person-Bob')
    .getByTestId('fig-layer-row')
    .filter({ hasText: /^Primary button$/ });
  await alice.hover();
  await alice.getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(
    bob.getByRole('button', { name: 'Unlock', exact: true })
  ).toBeVisible();
  await bob.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(
    alice.getByRole('button', {
      name: 'Lock',
      exact: true,
      includeHidden: true,
    })
  ).toBeAttached();
  await expect(
    bob.getByRole('button', { name: 'Lock', exact: true, includeHidden: true })
  ).toBeAttached();
  expect(await page.evaluate(() => window.figFixture.errors())).toEqual([]);
});

test('unlocks all selected layers with the shortcut and supports undo', async ({
  page,
}) => {
  await page.goto('/?new');
  await expect(page.getByTestId('fig-viewer')).toBeVisible();
  const canvas = page.getByTestId('fig-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas missing');
  for (const x of [100, 300]) {
    await canvas.focus();
    await page.keyboard.press('r');
    await page.mouse.move(box.x + x, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + x + 100, box.y + 200, { steps: 4 });
    await page.mouse.up();
  }
  const rows = page.getByTestId('fig-layer-row');
  await expect(rows).toHaveCount(2);
  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ['Shift'] });
  await canvas.focus();
  const locks = () =>
    page.evaluate(async () => {
      const engine = window.figFixture.engine()!;
      const hits = await engine.search(0, 'Rectangle');
      return (
        await engine.rows(
          0,
          hits.map((r) => r.id)
        )
      ).map((r) => r.locked);
    });
  await page.keyboard.press('ControlOrMeta+Shift+l');
  await expect.poll(locks).toEqual([true, true]);
  await page.keyboard.press('ControlOrMeta+Shift+l');
  await expect.poll(locks).toEqual([false, false]);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(locks).toEqual([true, true]);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(locks).toEqual([false, false]);
  expect(await page.evaluate(() => window.figFixture.errors())).toEqual([]);
});

test('unlocks an imported component instance and keeps its row in sync', async ({
  page,
}) => {
  await page.goto('/?file=showcase.fig&edit');
  await expect(page.getByTestId('fig-viewer')).toBeVisible();
  const seed = await page.evaluate(async () => {
    const engine = window.figFixture.engine()!;
    const row = (await engine.search(0, 'Primary button')).find(
      (r) => r.name === 'Primary button'
    )!;
    await engine.apply(0, [
      { op: 'set', ids: [row.id], props: { locked: true } },
    ]);
    return { id: row.id, bytes: Array.from(await engine.save()) };
  });
  await page.getByTestId('fig-file-input').setInputFiles({
    name: 'locked.fig',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(seed.bytes),
  });
  await expect(page.getByRole('banner')).toContainText('locked');
  await expect(page.getByTestId('fig-viewer')).toBeVisible();
  await page.getByRole('button', { name: 'Find layers', exact: true }).click();
  await page
    .getByRole('searchbox', { name: 'Find layers' })
    .fill('Primary button');
  await page
    .getByTestId('fig-search-hit')
    .filter({ hasText: /^Primary button$/ })
    .click();
  await page.getByRole('button', { name: 'Close search' }).click();
  const row = page.locator(`[data-layer-id="${seed.id}"]`);
  await row.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          window.figFixture
            .engine()!
            .nodeInfo(0, id)
            .then((r) => r.locked),
        seed.id
      )
    )
    .toBe(false);
  await expect(
    row.getByRole('button', { name: 'Lock', exact: true })
  ).toBeAttached();
  await row.hover();
  await row.getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(
    row.getByRole('button', { name: 'Unlock', exact: true })
  ).toBeVisible();
  expect(await page.evaluate(() => window.figFixture.errors())).toEqual([]);
});

test('toggles the Mobile Interfaces Logotype with expanded instance children', async ({
  page,
}) => {
  test.skip(!process.env.FIG_LOCK_CORPUS, 'Local reproduction corpus only');
  await page.goto('/?edit');
  await page
    .getByTestId('fig-file-input')
    .setInputFiles(`${process.env.FIG_LOCK_CORPUS}/Mobile.fig`);
  await expect(page.getByTestId('fig-viewer')).toBeVisible();
  await page.getByRole('button', { name: 'Find layers', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Find layers' }).fill('Logotype');
  await page
    .getByTestId('fig-search-hit')
    .filter({ hasText: /^Logotype$/ })
    .click();
  await page.getByRole('button', { name: 'Close search' }).click();
  const row = page.locator('[data-layer-id="3:838"]');
  await row.getByRole('button', { name: 'Expand', exact: true }).click();
  await row.hover();
  await row.getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(
    row.getByRole('button', { name: 'Unlock', exact: true })
  ).toBeVisible();
  await row.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await window.figFixture.engine()!.nodeInfo(0, '3:838')).locked
      )
    )
    .toBe(false);
  await expect(
    row.getByRole('button', { name: 'Lock', exact: true })
  ).toBeAttached();
  await page.screenshot({
    path: test.info().outputPath('unlocked-logotype.png'),
  });
  expect(await page.evaluate(() => window.figFixture.errors())).toEqual([]);
});

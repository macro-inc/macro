import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.hostname === 'localhost' &&
      !url.pathname.startsWith('/__macro_dev/')
      ? route.continue()
      : route.fulfill({ status: 404, json: {} });
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
});
for (const count of [3, 4, 5, 6]) {
  test(`pinning matrix preserves tracks and restores layout: ${count}`, async ({
    page,
  }, testInfo) => {
    test.skip(
      process.env.CALL_FULL_HOST !== 'true' || testInfo.project.name === 'phone'
    );
    test.setTimeout(240_000);
    for (const layout of ['auto', 'grid', 'speaker', 'sidebar']) {
      for (const share of ['', 'remote']) {
        const query = new URLSearchParams({
          count: String(count),
          layout,
          share,
          media: 'on',
          baseline: 'branch',
          view: 'messages',
          work: 'off',
        });
        await page.goto(
          `/src/features/channel/Call/discussion/browser-test/call-overlay.html?${query}`,
          { waitUntil: 'domcontentloaded' }
        );
        const tile = page
          .locator('[data-call-participant="macro|member@example.com"]')
          .last();
        await expect(tile).toBeVisible({ timeout: 30_000 });
        const tracks = await page
          .locator('canvas[data-fixture-track]')
          .elementHandles();
        const arrangement = () =>
          page.locator('[data-call-tile]').evaluateAll((tiles) =>
            tiles.map((element) => {
              const box = element.getBoundingClientRect();
              return [box.x, box.y, box.width, box.height].map(Math.round);
            })
          );
        const previous = await arrangement();
        const alreadyStaged =
          (await tile.getAttribute('data-call-stage')) !== null;
        const originalStage = await tile.boundingBox();
        await tile.hover();
        await tile.getByRole('button', { name: /^Pin / }).last().click();
        await expect(
          tile.getByRole('button', { name: /^Unpin / }).last()
        ).toBeVisible();
        const stage = await tile.boundingBox();
        expect(stage!.width).toBeGreaterThan(500);
        expect(stage!.width / stage!.height).toBeCloseTo(16 / 9, 1);
        if (alreadyStaged) expect(stage).toEqual(originalStage);
        for (const track of tracks)
          expect(await track.evaluate((element) => element.isConnected)).toBe(
            true
          );
        if (process.env.CALL_REPRO_DIR)
          await page.screenshot({
            path: `${process.env.CALL_REPRO_DIR}/L89-${layout}-${count}-${share || 'camera'}-pin.png`,
            animations: 'disabled',
          });
        await tile
          .getByRole('button', { name: /^Unpin / })
          .last()
          .click();
        await expect.poll(arrangement).toEqual(previous);
        for (const track of tracks)
          expect(await track.evaluate((element) => element.isConnected)).toBe(
            true
          );
        if (process.env.CALL_REPRO_DIR)
          await page.screenshot({
            path: `${process.env.CALL_REPRO_DIR}/L89-${layout}-${count}-${share || 'camera'}-unpin.png`,
            animations: 'disabled',
          });
      }
    }
  });
}

test('pinning matrix preserves portrait camera aspect ratio', async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.CALL_FULL_HOST !== 'true' || testInfo.project.name === 'phone'
  );
  await page.goto(
    '/src/features/channel/Call/discussion/browser-test/call-overlay.html?count=3&layout=grid&media=on&portrait=true&view=messages&work=off'
  );
  const tile = page
    .locator('[data-call-participant="macro|member@example.com"]')
    .last();
  await tile.hover();
  await tile.getByRole('button', { name: /^Pin / }).last().click();
  await expect(tile).toHaveAttribute('data-call-stage', '');
  const box = await tile.boundingBox();
  expect(box!.width / box!.height).toBeCloseTo(9 / 16, 1);
});

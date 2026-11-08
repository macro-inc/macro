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

test('companion controls keep sharing, mute and reactions usable in the mini player', async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.CALL_FULL_HOST !== 'true' || testInfo.project.name === 'phone'
  );
  await page.goto(
    '/src/features/channel/Call/discussion/browser-test/call-overlay.html?surface=player&count=1&media=on&work=off'
  );
  const player = page.getByRole('region');
  await expect(player).toBeVisible({ timeout: 30_000 });
  if (process.env.CALL_REPRO_DIR)
    await page.screenshot({
      path: `${process.env.CALL_REPRO_DIR}/L91-${process.env.CALL_REPRO_PHASE ?? 'after'}.png`,
    });
  await expect(
    player.getByRole('status', { name: 'You are muted' })
  ).toBeVisible();
  await player.getByRole('button', { name: 'Unmute microphone' }).click();
  await expect(
    player.getByRole('status', { name: 'You are muted' })
  ).toHaveCount(0);
  await player.getByRole('button', { name: 'Screen share settings' }).click();
  const audio = page.getByRole('menuitemcheckbox', { name: 'Share audio' });
  await audio.click();
  await expect(audio).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await player
    .getByRole('button', { name: 'Share screen', exact: true })
    .click();
  await expect(
    player.getByRole('button', { name: 'Stop sharing screen' })
  ).toBeVisible();
  await player.getByRole('button', { name: 'Reactions', exact: true }).click();
  await page.getByRole('button', { name: '👍', exact: true }).click();
  await expect(player.locator('.call-reaction')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.evaluate(() =>
    window.dispatchEvent(new Event('fixture-reaction'))
  );
  await expect(player.locator('.call-reaction')).toHaveCount(2);
  const handle = await player
    .locator('[role="separator"][aria-orientation="vertical"]')
    .first()
    .boundingBox();
  await page.mouse.move(
    handle!.x + handle!.width / 2,
    handle!.y + handle!.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(handle!.x + 100, handle!.y + handle!.height / 2);
  await page.mouse.up();
  const bounds = await player.boundingBox();
  expect(bounds!.width).toBe(256);
  for (const button of await player
    .locator('[data-call-controls] button')
    .all()) {
    const box = await button.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(bounds!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
  }
  const groups = player.locator('[data-call-controls] > div');
  expect(
    await groups.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).gap)
    )
  ).toBeGreaterThanOrEqual(8);
});

test('companion controls receive reduced-motion reactions over remote video', async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.CALL_FULL_HOST !== 'true' || testInfo.project.name === 'phone'
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(
    '/src/features/channel/Call/discussion/browser-test/call-overlay.html?surface=player&count=2&media=on&work=off'
  );
  const player = page.getByRole('region');
  await expect(player).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(new Event('fixture-reaction'))
  );
  const reaction = player.locator('.call-reaction');
  await expect(reaction).toHaveText('👍');
  expect(
    await reaction.evaluate(
      (element) => getComputedStyle(element).animationName
    )
  ).toBe('call-reaction-fade');
  expect(
    await reaction.evaluate((element) => getComputedStyle(element).transform)
  ).toBe('none');
  if (process.env.CALL_REPRO_DIR)
    await page.screenshot({
      path: `${process.env.CALL_REPRO_DIR}/L91-reduced-motion.png`,
    });
  await expect(reaction).toHaveCount(0);
});

test('companion controls open reactions from the unchanged call popover header', async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.CALL_FULL_HOST !== 'true' || testInfo.project.name === 'phone'
  );
  await page.goto(
    '/src/features/channel/Call/discussion/browser-test/call-overlay.html?surface=popover&count=2&media=on&work=off'
  );
  const popup = page.getByRole('dialog').first();
  await expect(popup).toBeVisible();
  if (process.env.CALL_REPRO_DIR)
    await page.screenshot({
      path: `${process.env.CALL_REPRO_DIR}/L92-${process.env.CALL_REPRO_PHASE ?? 'after'}.png`,
    });
  const header = await popup.locator(':scope > div').first().boundingBox();
  const controls = popup.locator('[data-call-controls]');
  expect(
    await controls
      .locator(':scope > div')
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).gap))
  ).toBeGreaterThanOrEqual(8);
  await expect(
    popup.getByRole('button', { name: 'Reactions', exact: true })
  ).toBeVisible();
  await popup.getByRole('button', { name: 'Reactions', exact: true }).click();
  await page.getByRole('button', { name: '👍', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(popup).toBeVisible();
  expect(await popup.locator(':scope > div').first().boundingBox()).toEqual(
    header
  );
  const bounds = await popup.boundingBox();
  for (const button of await controls.locator('button').all()) {
    const box = await button.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(bounds!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
  }
});

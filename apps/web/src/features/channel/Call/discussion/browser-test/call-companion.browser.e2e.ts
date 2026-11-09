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
  await expect(
    controls.getByRole('button', { name: 'Call sharing', exact: true })
  ).toHaveCount(0);
  if (process.env.CALL_REPRO_DIR)
    await page.screenshot({
      path: `${process.env.CALL_REPRO_DIR}/L103-popover.png`,
    });
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
  const row = await controls
    .getByRole('button', { name: 'Unmute microphone' })
    .boundingBox();
  for (const button of await controls.locator('button').all()) {
    const box = await button.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(bounds!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
    expect(box!.y + box!.height / 2).toBe(row!.y + row!.height / 2);
  }
});

test('companion controls match the shared bar height', async ({
  page,
}, info) => {
  test.skip(
    process.env.CALL_FULL_HOST !== 'true' || info.project.name === 'phone'
  );
  for (const width of [1280, 600]) {
    for (const theme of ['dark', 'light']) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/src/features/channel/Call/discussion/browser-test/call-overlay.html?theme=${theme}&work=off`
      );
      const controls = page.locator('[data-call-controls]');
      await expect(controls).toBeVisible();
      const microphone = await controls
        .getByRole('group', { name: 'Microphone', exact: true })
        .boundingBox();
      expect(microphone?.height).toBe(width === 1280 ? 40 : 32);
      for (const label of ['Camera', 'Screen share']) {
        expect(
          (
            await controls
              .getByRole('group', { name: label, exact: true })
              .boundingBox()
          )?.height
        ).toBe(microphone?.height);
      }
      for (const label of ['Reactions', 'More', 'Leave call']) {
        const button = controls.getByRole('button', {
          name: label,
          exact: true,
        });
        if (await button.isVisible())
          expect((await button.boundingBox())?.height).toBe(microphone?.height);
      }
      expect(
        (
          await page
            .getByRole('button', {
              name: 'Open chat and participants',
              exact: true,
            })
            .boundingBox()
        )?.height
      ).toBe(microphone?.height);
      if (process.env.CALL_REPRO_DIR)
        await page.screenshot({
          path: `${process.env.CALL_REPRO_DIR}/L102-${width}-${theme}.png`,
        });
    }
  }
});

test('companion controls explain disabled screen audio', async ({
  page,
}, info) => {
  test.skip(
    process.env.CALL_FULL_HOST !== 'true' || info.project.name === 'phone'
  );
  for (const reason of ['sharing', 'connecting', 'enabled']) {
    await page.goto(
      `/src/features/channel/Call/discussion/browser-test/call-overlay.html?work=off&share=${reason === 'sharing' ? 'local' : ''}`
    );
    await page
      .getByRole('button', { name: 'Screen share settings', exact: true })
      .click();
    const row = page.getByRole('menuitemcheckbox', {
      name: 'Share audio',
      exact: true,
    });
    await expect(row).toBeVisible();
    if (reason === 'connecting')
      await page.evaluate(() =>
        window.dispatchEvent(new Event('fixture-connecting'))
      );
    await row.hover();
    if (reason === 'enabled') {
      await expect(
        page.getByRole('tooltip', { includeHidden: true })
      ).toHaveCount(0);
      await row.click();
      await expect(row).toHaveAttribute('aria-checked', 'true');
    } else {
      const message =
        reason === 'sharing'
          ? 'Stop sharing to change this'
          : "Available once you've joined";
      await expect(row).toHaveAttribute('aria-disabled', 'true');
      await expect(row).toHaveAccessibleDescription(message);
      await expect(
        page.getByRole('tooltip', { includeHidden: true })
      ).toContainText(message);
      await row.click({ force: true });
      await expect(row).toHaveAttribute('aria-checked', 'false');
      await page.mouse.move(0, 0);
      await page.keyboard.press('Home');
      await expect(row).toBeFocused();
      await expect(
        page.getByRole('tooltip', { includeHidden: true })
      ).toContainText(message);
    }
    if (process.env.CALL_REPRO_DIR)
      await page.screenshot({
        path: `${process.env.CALL_REPRO_DIR}/L104-${reason}.png`,
      });
  }
});

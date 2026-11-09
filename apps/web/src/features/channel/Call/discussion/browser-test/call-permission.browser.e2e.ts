import { expect, test } from '@playwright/test';

test('blocked media permissions recover across call controls', async ({
  page,
  context,
  baseURL,
}, info) => {
  test.skip(process.env.CALL_FULL_HOST !== 'true');
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.hostname === 'localhost' &&
      !url.pathname.startsWith('/__macro_dev/')
      ? route.continue()
      : route.fulfill({ status: 404, json: {} });
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  const client = await context.newCDPSession(page);
  const { targetInfo } = await client.send('Target.getTargetInfo');
  const origin = new URL(baseURL ?? 'http://localhost:3071').origin;
  for (const name of ['microphone', 'camera']) {
    await client.send('Browser.setPermission', {
      permission: { name },
      setting: 'denied',
      browserContextId: targetInfo.browserContextId,
      origin,
    });
  }
  for (const theme of ['dark', 'light']) {
    await page.goto(
      `/src/features/channel/Call/discussion/browser-test/call-overlay.html?theme=${theme}&work=off`
    );
    const mic = page.getByRole('button', {
      name: /^Microphone blocked by the browser/,
    });
    const camera = page.getByRole('button', {
      name: /^Camera blocked by the browser/,
    });
    await expect(mic).toBeVisible();
    await expect(camera).toBeVisible();
    await expect(page.locator('[data-call-permission-badge]')).toHaveCount(2);
    if (process.env.CALL_REPRO_DIR)
      await page.screenshot({
        path: `${process.env.CALL_REPRO_DIR}/L101-${info.project.name}-${theme}.png`,
      });
    await mic.click();
    await expect(page.getByRole('alert')).toContainText('Microphone blocked');
    if (info.project.name !== 'phone') {
      await page
        .getByRole('button', { name: 'Audio settings', exact: true })
        .click();
      await expect(page.getByRole('menu')).toBeVisible();
      await page.keyboard.press('Escape');
    }
    if (process.env.CALL_REPRO_DIR)
      await page.screenshot({
        path: `${process.env.CALL_REPRO_DIR}/L101-${info.project.name}-${theme}.png`,
      });
  }
  for (const name of ['microphone', 'camera']) {
    await client.send('Browser.setPermission', {
      permission: { name },
      setting: 'granted',
      browserContextId: targetInfo.browserContextId,
      origin,
    });
  }
  await expect(page.locator('[data-call-permission-badge]')).toHaveCount(0);
});

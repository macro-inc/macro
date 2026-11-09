import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const artifacts = process.env.CALL_REPRO_DIR;
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

for (const surface of ['bar', 'popover', 'player']) {
  test(`permission recovery on ${surface}`, async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(test.info().project.name === 'phone' && surface !== 'bar');
    const client = await context.newCDPSession(page);
    const { targetInfo } = await client.send('Target.getTargetInfo');
    for (const theme of ['dark', 'light']) {
      for (const device of ['microphone', 'camera']) {
        await client.send('Browser.setPermission', {
          permission: { name: device },
          setting: 'denied',
          browserContextId: targetInfo.browserContextId,
          origin: new URL(baseURL!).origin,
        });
        await page.goto(
          `/src/features/channel/Call/discussion/browser-test/call-overlay.html?capture=permissions&work=off&surface=${surface}&theme=${theme}`,
          { waitUntil: 'domcontentloaded' }
        );
        const blocked = page.getByRole('button', {
          name: new RegExp(
            `^${device === 'camera' ? 'Camera' : 'Microphone'} blocked`
          ),
        });
        await expect(blocked).toBeVisible();
        if (device === 'microphone')
          await page.locator('[data-call-permission-badge]').first().click();
        else await blocked.click();
        const dialog = page.getByRole('dialog', {
          name: device === 'camera' ? 'Enable camera' : 'Enable microphone',
        });
        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByRole('button', { name: 'Try again' })
        ).toBeEnabled();
        await dialog.getByRole('button', { name: 'Try again' }).click();
        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByRole('button', { name: 'Try again' })
        ).toBeEnabled();
        if (artifacts) {
          await mkdir(artifacts, { recursive: true });
          await page.screenshot({
            path: `${artifacts}/L125-${surface}-${device}-${theme}.png`,
          });
        }
        await client.send('Browser.setPermission', {
          permission: { name: device },
          setting: 'granted',
          browserContextId: targetInfo.browserContextId,
          origin: new URL(baseURL!).origin,
        });
        await expect(dialog).toBeHidden();
        await expect(
          page.getByRole('button', {
            name: device === 'camera' ? 'Turn off camera' : 'Mute microphone',
            exact: true,
          })
        ).toBeVisible();
      }
    }
  });
}

test('prompt state requests capture from the call', async ({
  page,
  context,
  baseURL,
}) => {
  const client = await context.newCDPSession(page);
  const { targetInfo } = await client.send('Target.getTargetInfo');
  await client.send('Browser.setPermission', {
    permission: { name: 'microphone' },
    setting: 'prompt',
    browserContextId: targetInfo.browserContextId,
    origin: new URL(baseURL!).origin,
  });
  await page.goto(
    '/src/features/channel/Call/discussion/browser-test/call-overlay.html?capture=true&work=off',
    { waitUntil: 'domcontentloaded' }
  );
  await page
    .getByRole('button', { name: 'Unmute microphone', exact: true })
    .click();
  await client.send('Browser.setPermission', {
    permission: { name: 'microphone' },
    setting: 'granted',
    browserContextId: targetInfo.browserContextId,
    origin: new URL(baseURL!).origin,
  });
  await expect(
    page.getByRole('button', { name: 'Mute microphone', exact: true })
  ).toBeVisible();
});

test('permission help follows its device and restores focus only on dismissal', async ({
  page,
  context,
  baseURL,
}) => {
  const client = await context.newCDPSession(page);
  const { targetInfo } = await client.send('Target.getTargetInfo');
  for (const name of ['microphone', 'camera'])
    await client.send('Browser.setPermission', {
      permission: { name },
      setting: 'denied',
      browserContextId: targetInfo.browserContextId,
      origin: new URL(baseURL!).origin,
    });
  for (const theme of ['dark', 'light']) {
    await page.goto(
      `/src/features/channel/Call/discussion/browser-test/call-overlay.html?capture=permissions&work=off&theme=${theme}`,
      { waitUntil: 'domcontentloaded' }
    );
    const mic = page.getByRole('button', { name: /^Microphone blocked/ });
    const camera = page.getByRole('button', { name: /^Camera blocked/ });
    await mic.click();
    await expect(
      page.getByRole('dialog', { name: 'Enable microphone' })
    ).toBeVisible();
    await camera.click();
    const help = page.getByRole('dialog', { name: 'Enable camera' });
    await expect(help).toBeVisible();
    const anchor = await camera.boundingBox();
    const rect = await help.boundingBox();
    if (test.info().project.name === 'desktop') {
      expect(
        Math.abs(rect!.x + rect!.width / 2 - (anchor!.x + anchor!.width / 2))
      ).toBeLessThan(2);
    }
    if (artifacts) {
      await mkdir(artifacts, { recursive: true });
      await page.screenshot({
        path: `${artifacts}/permission-help-anchor-${test.info().project.name}-${theme}.png`,
      });
    }
    await help.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(help).toBeHidden();
    await expect(camera).toBeFocused();
    await mic.click();
    const micHelp = page.getByRole('dialog', { name: 'Enable microphone' });
    await expect(micHelp).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(micHelp).toBeHidden();
    await expect(mic).toBeFocused();
    await camera.click();
    await expect(help).toBeVisible();
    const outside = page.getByRole('button', { name: 'Refresh discussion' });
    await outside.click();
    await expect(help).toBeHidden();
    await expect(outside).toBeFocused();
  }
});

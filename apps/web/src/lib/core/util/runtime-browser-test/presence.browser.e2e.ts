import { expect, test } from '@playwright/test';

test('unanimated indicators skip style discovery and animated exits retain presence', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let reads = 0;
    let staticReads = 0;
    Object.defineProperty(window, 'presenceStaticReads', {
      get: () => staticReads,
    });
    Object.defineProperty(window, 'presenceStyleReads', { get: () => reads });
    const original = window.getComputedStyle;
    window.getComputedStyle = function (...args) {
      if (new Error().stack?.includes('solid-presence')) {
        reads++;
        if (args[0].hasAttribute('data-static-indicator')) staticReads++;
      }
      return original.apply(this, args);
    };
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto('/presence.html');
  await expect(page.getByRole('checkbox')).toHaveCount(200);
  // Let the one deliberately animated target finish its entry animation.
  await expect(page.locator('#animated-presence')).toHaveCSS(
    'animation-name',
    'entering'
  );
  const reads = await page.evaluate(() =>
    Reflect.get(window, 'presenceStyleReads')
  );
  console.log('initial presence style reads:', reads);
  // One target animates; the 200 force-mounted checkbox indicators do not.
  expect(reads).toBeLessThanOrEqual(2);
  expect(
    await page.evaluate(() => Reflect.get(window, 'presenceStaticReads'))
  ).toBe(0);
  await page.getByRole('button', { name: 'Toggle presence' }).click();
  await expect(page.locator('#presence-state')).toHaveText('hiding');
  await expect(page.locator('#animated-presence')).toBeVisible();
  await expect(page.locator('#presence-state')).toHaveText('hidden');
  await expect(page.locator('#animated-presence')).toHaveCount(0);
  await page.getByRole('button', { name: 'Toggle presence' }).click();
  await expect(page.locator('#animated-presence')).toBeVisible();
  await expect(page.locator('#presence-state')).toHaveText('present');
});

test('retains Kobalte indicator exit animations and handles rapid reopen', async ({
  page,
}) => {
  await page.goto('/presence.html?kobalte');
  const indicator = page.locator('#animated-checkbox');
  await expect(indicator).toBeVisible();
  await page.getByRole('button', { name: 'Toggle checkbox' }).click();
  await expect(indicator).toBeVisible();
  await expect(indicator).toHaveCSS('animation-name', 'leaving');
  await page.getByRole('button', { name: 'Toggle checkbox' }).click();
  await expect(indicator).toBeVisible();
  await expect(indicator).toHaveCSS('animation-name', 'entering');
  await page.getByRole('button', { name: 'Toggle checkbox' }).click();
  await expect(indicator).toHaveCount(0);
});

for (const kobalte of [false, true]) {
  test(`unmounts unanimated ${kobalte ? 'Kobalte' : 'Corvu'} presence immediately`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/presence.html${kobalte ? '?kobalte' : ''}`);
    const target = page.locator(
      kobalte ? '#animated-checkbox' : '#animated-presence'
    );
    await expect(target).toBeVisible();
    await expect(target).toHaveCSS('animation-name', 'none');
    await page
      .getByRole('button', {
        name: kobalte ? 'Toggle checkbox' : 'Toggle presence',
      })
      .click();
    await expect(target).toHaveCount(0);
  });
}

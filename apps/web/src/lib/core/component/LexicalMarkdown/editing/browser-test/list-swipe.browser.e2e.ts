import { expect, test } from '@playwright/test';

test('installed trusted touch swipe nests a row and respects read-only and disposal', async ({
  page,
  browserName,
}, info) => {
  test.skip(
    browserName !== 'chromium' || !info.project.use.hasTouch,
    'Trusted touch protocol is Chromium touch profile only'
  );
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await page
    .getByRole('button', { name: 'Load swipe list', exact: true })
    .click();
  const cdp = await page.context().newCDPSession(page);
  const swipe = async (dx: number) => {
    const target = page.getByText('Open row', { exact: true });
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (!box) throw new Error('Missing actual list row geometry');
    const x = box.x + Math.min(box.width / 2, 30);
    const y = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y, id: 1 }],
    });
    for (const part of [0.2, 0.4, 0.6, 0.8, 1]) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + dx * part, y, id: 1 }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
  };
  const nested = page.locator('#body li ul li').filter({ hasText: 'Open row' });
  try {
    await swipe(70);
    await expect(nested).toHaveCount(1);
    await info.attach('focus-before-keyboard-undo', {
      body: await page.evaluate(() => document.activeElement?.outerHTML ?? ''),
      contentType: 'text/plain',
    });
    await page.locator('#body').focus();
    await page.keyboard.press('Control+z');
    await expect(nested).toHaveCount(0);
    await page.keyboard.press('Control+Shift+z');
    await expect(nested).toHaveCount(1);
    await swipe(-70);
    await expect(nested).toHaveCount(0);
    await page.getByRole('button', { name: 'Read only', exact: true }).click();
    await swipe(70);
    await expect(nested).toHaveCount(0);
    await page.getByRole('button', { name: 'Editable', exact: true }).click();
    await page
      .getByRole('button', { name: 'Dispose overlays', exact: true })
      .click();
    await swipe(70);
    await expect(nested).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Remount overlays', exact: true })
      .click();
    await swipe(70);
    await expect(nested).toHaveCount(1);
    await expect(page.locator('#errors')).toHaveText('');
  } finally {
    await cdp.detach();
  }
});

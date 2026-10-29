import { expect, test } from '@playwright/test';

const fixture = '/src/components/view-shell/browser-test/sidebar-title.html';

test('keeps the Chat sidebar title whole at a typical rail width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(fixture, { waitUntil: 'networkidle' });
  if (pageErrors.length) {
    throw new Error(pageErrors.join('\n'));
  }
  const trigger = page.getByRole('button', { name: 'Chat' });
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveText(/Chat/);
  const box = await trigger.boundingBox();
  expect(box).toBeTruthy();
  expect(box!.width).toBeGreaterThan(48);
  const overflow = await trigger.evaluate((el) => {
    const label = el.querySelector('span');
    return label ? label.scrollWidth - label.clientWidth : 0;
  });
  expect(overflow).toBeLessThanOrEqual(1);
});

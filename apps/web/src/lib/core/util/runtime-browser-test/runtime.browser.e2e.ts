import { expect, test } from '@playwright/test';

test('tracks focus removal and batches compaction of a long list', async ({
  page,
}) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'Editor' });
  await editor.focus();
  await expect(page.locator('body')).toHaveAttribute('data-active', 'INPUT');
  await page.evaluate(() => {
    const unrelated = document.getElementById('unrelated')!;
    for (let i = 0; i < 100; i++)
      unrelated.replaceChildren(document.createElement('span'));
  });
  await expect(editor).toBeFocused();
  await page.evaluate(() => document.getElementById('editor')!.remove());
  await expect(page.locator('body')).toHaveAttribute('data-active', 'BODY');
  await expect(page.locator('[data-compact="true"]')).toHaveCount(100);

  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await session.send('Performance.enable');
  const before = await session.send('Performance.getMetrics');
  await page.getByRole('button', { name: 'Change labels' }).click();
  await expect(page.locator('[data-compact="false"]')).toHaveCount(100);
  const after = await session.send('Performance.getMetrics');
  const layouts =
    after.metrics.find((entry) => entry.name === 'LayoutCount')!.value -
    before.metrics.find((entry) => entry.name === 'LayoutCount')!.value;
  expect(layouts).toBeLessThan(10);
  await page.getByRole('button', { name: 'Grow rows' }).click();
  await expect(page.locator('[data-compact="false"]')).toHaveCount(100);
});

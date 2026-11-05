import { expect, test } from '@playwright/test';

test.setTimeout(60_000);

test('a tool group opens under the pointer while the reply streams below it', async ({
  page,
  isMobile,
}) => {
  await page.goto('/transcript.html');
  const group = page.getByRole('button', { name: 'Called 2 tools' });
  await expect(group).toBeVisible({ timeout: 30_000 });
  // The transcript follows the streaming answer, carrying the group upward.
  const following = (await group.boundingBox())!;
  await expect
    .poll(async () => (await group.boundingBox())!.y)
    .toBeLessThan(following.y - 20);

  const pressed = (await group.boundingBox())!;
  const x = pressed.x + 20;
  const y = pressed.y + pressed.height / 2;
  if (isMobile) {
    await page.touchscreen.tap(x, y);
  } else {
    // A real click lasts long enough for streamed lines to arrive mid-press.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(250);
    await page.mouse.up();
  }

  await expect(group).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('region', { name: 'Tool calls' })).toBeVisible();
  // Keep streaming well past the press before checking the group stayed put.
  const sentences = () =>
    page.evaluate(
      () => document.body.textContent?.match(/Sentence \d+ of/g)?.length ?? 0
    );
  const streamed = await sentences();
  await expect.poll(sentences).toBeGreaterThan(streamed + 10);
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  expect((await group.boundingBox())!.y).toBeCloseTo(pressed.y, 0);
  await page.screenshot({ path: test.info().outputPath('opened.png') });
});

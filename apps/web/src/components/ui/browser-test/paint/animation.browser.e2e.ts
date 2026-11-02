import { expect, test } from '@playwright/test';

test('working decorations stop offscreen, resume in view, and preserve reduced motion', async ({
  page,
}) => {
  await page.goto('/?kind=working&offscreen=true&count=12');
  await expect(
    page.getByText('Working', { exact: true }).first()
  ).toBeAttached();
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.getAnimations().map((animation) => animation.playState)
      )
    )
    .toEqual(Array(48).fill('paused'));
  await page.locator('[data-samples]').scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      page.evaluate(() =>
        document
          .getAnimations()
          .every((animation) => animation.playState === 'running')
      )
    )
    .toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() => page.evaluate(() => document.getAnimations().length))
    .toBe(0);
});

test('brand loader pauses its actual motion offscreen and respects reduced motion', async ({
  page,
}) => {
  await page.goto('/?kind=loader&offscreen=true&count=1');
  await expect
    .poll(() =>
      page.evaluate(() => document.getAnimations().map((a) => a.playState))
    )
    .toEqual(Array(3).fill('paused'));
  const before = await page.evaluate(() =>
    document.getAnimations().map((a) => a.currentTime)
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  expect(
    await page.evaluate(() =>
      document.getAnimations().map((a) => a.currentTime)
    )
  ).toEqual(before);
  await page.locator('[data-samples]').scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      page.evaluate(() => document.getAnimations().map((a) => a.playState))
    )
    .toEqual(Array(3).fill('running'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() => page.evaluate(() => document.getAnimations().length))
    .toBe(0);
});

test('agent spin and pulse utilities pause offscreen and resume in view', async ({
  page,
}) => {
  await page.goto('/?kind=agents&offscreen=true&count=12');
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.getAnimations().map((animation) => animation.playState)
      )
    )
    .toEqual(Array(24).fill('paused'));
  await page.locator('[data-samples]').scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.getAnimations().map((animation) => animation.playState)
      )
    )
    .toEqual(Array(24).fill('running'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() => page.evaluate(() => document.getAnimations().length))
    .toBe(0);
});
test('pending skeletons become still after their entrance without removing placeholders', async ({
  page,
}) => {
  await page.goto('/?kind=skeleton&count=3');
  await expect(page.locator('.skeleton-shimmer')).toHaveCount(3);
  const states = await page.evaluate(async () => {
    const animations = document
      .getAnimations()
      .filter(
        (animation) =>
          animation instanceof CSSAnimation &&
          animation.animationName === 'skeleton-shimmer'
      );
    if (animations.length !== 3)
      throw new Error('Skeleton entrance did not start');
    await Promise.all(animations.map((animation) => animation.finished));
    return animations.map((animation) => ({
      state: animation.playState,
      attached:
        animation.effect instanceof KeyframeEffect &&
        animation.effect.target?.isConnected,
    }));
  });
  expect(states).toEqual(Array(3).fill({ state: 'finished', attached: true }));
});

test('legacy brand loader retains a visible static pose with reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?kind=legacy-loader&count=1');
  const svg = page.locator('[data-samples] svg');
  await expect(svg).toBeVisible();
  const visible = await svg.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return Array.from(
      element.querySelectorAll('.macro-brand-legacy-column')
    ).map((column) => {
      const pose = column.getBoundingClientRect();
      return (
        pose.bottom > bounds.top &&
        pose.top < bounds.bottom &&
        pose.right > bounds.left &&
        pose.left < bounds.right
      );
    });
  });
  expect(visible).toEqual([true, true, true]);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

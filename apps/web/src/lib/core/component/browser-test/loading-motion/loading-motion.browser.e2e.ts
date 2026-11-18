import { expect, type Page, test } from '@playwright/test';

const FIXTURE =
  '/src/lib/core/component/browser-test/loading-motion/loading-motion.html';

type Platform = 'android' | 'ios' | 'macos' | 'web';

/** Stands in for a native app's Tauri bridge; every command rejects. */
async function emulateApp(page: Page, platform: Platform) {
  if (platform === 'web') return;
  await page.addInitScript((osType) => {
    const host = window as unknown as Record<string, unknown>;
    host.isTauri = true;
    host.__TAURI_OS_PLUGIN_INTERNALS__ = { os_type: osType, platform: osType };
    host.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: 'main' },
        currentWebview: { label: 'main', windowLabel: 'main' },
      },
      convertFileSrc: (path: string) => `asset://localhost/${path}`,
      transformCallback: () => 0,
      unregisterCallback: () => {},
      invoke: async (command: string) => {
        throw new Error(`No native command ${command}`);
      },
    };
  }, platform);
}

/** The timing function each loading indicator animates with. */
async function timings(page: Page) {
  return page.evaluate(() => {
    const timing = (element: Element | null, pseudo?: string) => {
      if (!element) throw new Error('Missing indicator');
      const style = getComputedStyle(element, pseudo);
      return style.animationName === 'none'
        ? 'none'
        : style.animationTimingFunction;
    };
    return {
      shimmer: timing(
        document.querySelector('[data-testid="shimmer"] .skeleton-shimmer'),
        '::after'
      ),
      spinner: timing(document.querySelector('[role="status"] svg')),
      indeterminate: timing(
        document.querySelector('[data-testid="indeterminate"]')
      ),
      calendar: timing(document.querySelector('[data-testid="calendar"]')),
    };
  });
}

/** Whether the brand loader's SMIL runs freely, and its time now. */
async function brandLoader(page: Page) {
  return page.evaluate(() => {
    const svg = document.querySelector<SVGSVGElement>(
      '[data-testid="brand"] svg'
    );
    if (!svg) throw new Error('Missing brand loader');
    return { paused: svg.animationsPaused(), time: svg.getCurrentTime() };
  });
}

test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('loading indicators move a few times a second on native Android', async ({
  page,
}) => {
  await emulateApp(page, 'android');
  await page.goto(FIXTURE);
  await expect(page.getByTestId('brand').locator('svg')).toBeVisible();

  expect(await timings(page)).toEqual({
    shimmer: 'steps(5, jump-none)',
    spinner: 'steps(8)',
    indeterminate: 'steps(6)',
    calendar: 'steps(1)',
  });

  // The brand loader holds still between steps and advances a quarter second
  // of its animation at each one.
  const first = await brandLoader(page);
  expect(first.paused).toBe(true);
  await expect
    .poll(async () => (await brandLoader(page)).time, { timeout: 2_000 })
    .toBeGreaterThanOrEqual(first.time + 0.5);
  const { time } = await brandLoader(page);
  expect((time * 4) % 1).toBeCloseTo(0, 5);
});

test('reduced motion still stills the shimmer and the shared spinner on Android', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await emulateApp(page, 'android');
  await page.goto(FIXTURE);
  await expect(page.getByTestId('brand').locator('svg')).toBeVisible();

  const motion = await timings(page);
  expect(motion.shimmer).toBe('none');
  expect(motion.spinner).toBe('none');
  expect(motion.calendar).toBe('none');
});

for (const platform of ['ios', 'macos', 'web'] as const) {
  test(`loading indicators keep their smooth motion on ${platform}`, async ({
    page,
  }) => {
    await emulateApp(page, platform);
    await page.goto(FIXTURE);
    await expect(page.getByTestId('brand').locator('svg')).toBeVisible();

    expect(await timings(page)).toEqual({
      shimmer: 'ease',
      spinner: 'linear',
      indeterminate: 'ease-in-out',
      calendar: 'ease-in-out',
    });
    const loader = await brandLoader(page);
    expect(loader.paused).toBe(false);
  });
}

import { expect, type Page, test } from '@playwright/test';

const fixture = '/src/features/agent-screen/browser-test/viewer.html';
// Set to keep a PNG of each state for review.
const shots = process.env.AGENT_SCREEN_SHOTS_DIR;

async function open(page: Page, query: string) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${fixture}?${query}`, { waitUntil: 'networkidle' });
  return errors;
}

async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`desktop split, ${theme}`, () => {
    test.use({
      viewport: { width: 640, height: 680 },
      contextOptions: { reducedMotion: 'reduce' },
    });

    test('driving: the pill is one line inside the picture and the frame goes all round it', async ({
      page,
    }) => {
      const errors = await open(page, `state=drive&width=600&theme=${theme}`);
      const pill = page.locator('[data-screen-driving-pill]');
      await expect(pill).toBeVisible();
      await expect(pill).toContainText('Eve is paused · tools held');
      await expect(pill).toContainText('Hold Esc to hand back');
      // The header pill says who drives; this one doesn't repeat it.
      await expect(pill).not.toContainText('You’re driving');
      await expect(page.getByRole('status')).toHaveText('You’re driving');

      const box = (await pill.boundingBox())!;
      expect(box.height).toBeLessThan(30);
      const stage = (await page
        .getByRole('img', { name: 'Eve’s desktop' })
        .boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(stage.x);
      expect(box.x + box.width).toBeLessThanOrEqual(stage.x + stage.width);

      // The driving frame is drawn over the picture, on its own box.
      const edge = page.locator('[data-screen-picture-edge="driven"]');
      await expect(edge).toHaveCSS('outline-style', 'solid');
      const frame = (await edge.boundingBox())!;
      expect(frame.width).toBeGreaterThan(500);
      expect(frame.height / frame.width).toBeCloseTo(800 / 1280, 1);
      await shot(page, `desktop-600-drive-${theme}`);
      expect(errors).toEqual([]);
    });

    test('driving in a narrow split keeps the pill on one line', async ({
      page,
    }) => {
      await open(page, `state=drive&width=380&theme=${theme}`);
      const pill = page.locator('[data-screen-driving-pill]');
      await expect(pill).toContainText('Hold Esc');
      expect((await pill.boundingBox())!.height).toBeLessThan(30);
      await shot(page, `desktop-380-drive-${theme}`);
    });

    test('watching: the picture shows its edge, Stop watching is neutral', async ({
      page,
    }) => {
      await open(page, `state=watch&width=600&theme=${theme}`);
      await expect(page.getByRole('status')).toHaveText('Live');
      await expect(page.locator('[data-screen-picture-edge=""]')).toBeVisible();
      await expect(page.locator('[data-screen-driving-pill]')).toHaveCount(0);
      const stop = page.getByRole('button', { name: 'Stop watching' });
      await expect(stop).toBeVisible();
      await expect(stop).not.toHaveClass(/danger/);
      await shot(page, `desktop-600-watch-${theme}`);
    });

    test('someone else driving: the pill says only what the agent does', async ({
      page,
    }) => {
      await open(page, `state=other&width=600&theme=${theme}`);
      await expect(page.getByRole('status')).toHaveText('Sam is driving');
      const pill = page.locator('[data-screen-driving-pill]');
      await expect(pill).toHaveText('Eve isn’t paused and keeps working');
      await shot(page, `desktop-600-other-${theme}`);
    });

    test('a DM header keeps the agent name readable beside its status', async ({
      page,
    }) => {
      for (const width of [600, 420]) {
        await open(page, `surface=dm-header&width=${width}&theme=${theme}`);
        const title = page.getByTestId('dm-title');
        await expect
          .poll(() =>
            title.evaluate((span) => span.scrollWidth <= span.clientWidth)
          )
          .toBe(true);
        await shot(page, `dm-header-${width}-${theme}`);
      }
    });
  });

  test.describe(`phone, ${theme}`, () => {
    test.use({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      contextOptions: { reducedMotion: 'reduce' },
    });

    for (const state of ['watch', 'drive'] as const) {
      test(`${state}: full screen, no repeated title, the picture fills the view`, async ({
        page,
      }) => {
        const errors = await open(
          page,
          `view=phone&state=${state}&theme=${theme}`
        );
        expect(await page.evaluate(() => innerWidth)).toBe(390);
        await expect(page.getByRole('status')).toHaveText(
          state === 'drive' ? 'You’re driving' : 'Live'
        );
        // The dock and New stand down while the screen shows.
        await expect(page.getByTestId('dock')).toHaveCount(0);
        await expect(page.getByTestId('new-button')).toHaveCount(0);
        await expect(
          page.getByText('Eve’s desktop', { exact: true })
        ).toHaveCount(1);
        const stage = (await page
          .getByRole('img', { name: 'Eve’s desktop' })
          .boundingBox())!;
        expect(stage.height).toBeGreaterThan(400);
        if (state === 'drive')
          await expect(
            page.getByText('Eve is paused · tools held')
          ).toBeVisible();
        await shot(page, `phone-${state}-${theme}`);
        expect(errors).toEqual([]);
      });
    }
  });
}

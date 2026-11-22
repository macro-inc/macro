import { expect, type Page, test } from '@playwright/test';

const fixture = '/src/features/agent-screen/browser-test/viewer.html';
const dmHeader = '/src/features/agent-screen/browser-test/dm-header.html';
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

    test('the real DM top bar: the Offline chip yields before the agent name', async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      // The stubs answer the header's own data; nothing reaches a backend.
      await page.route('**/__macro_dev/**', (route) => route.abort());
      const chip = page.locator('[data-agent-dm-chip="offline"]');
      const title = page.getByText('Eve', { exact: true });
      const truncated = () =>
        title.evaluate((span) => span.scrollWidth > span.clientWidth);

      // Room for both: the chip keeps its label.
      await page.goto(`${dmHeader}?width=600&theme=${theme}`, {
        waitUntil: 'networkidle',
      });
      await expect(chip).toHaveText('Offline');
      await expect(chip).not.toHaveAttribute('data-compact');
      await expect(page.getByRole('button', { name: 'Screen' })).toBeVisible();
      expect(await truncated()).toBe(false);
      await shot(page, `dm-header-600-${theme}`);

      // Narrower: the chip drops to its dot, and the name stays whole (at
      // this width it would truncate beside the labelled chip).
      await page.goto(`${dmHeader}?width=530&theme=${theme}`, {
        waitUntil: 'networkidle',
      });
      await expect(chip).toHaveAttribute('data-compact', '');
      await expect(chip).toHaveAttribute('title', 'Offline');
      await expect.poll(truncated).toBe(false);
      await shot(page, `dm-header-530-${theme}`);
      expect(errors).toEqual([]);
    });
  });

  test.describe(`viewer states, ${theme}`, () => {
    test.use({
      viewport: { width: 1320, height: 1040 },
      contextOptions: { reducedMotion: 'reduce' },
    });

    test('popped out: its own heading, and the picture at 16:9 across a wide dialog', async ({
      page,
    }) => {
      const errors = await open(page, `view=popout&theme=${theme}`);
      // Named, as the touch drawer is, so a screen reader says whose screen.
      const dialog = page.getByRole('dialog', { name: 'Eve' });
      await expect(dialog.getByRole('status')).toHaveText('Live');
      await expect(dialog.getByText('Eve’s desktop')).toBeVisible();
      // No pop-out button inside a pop-out.
      await expect(dialog.getByRole('button', { name: 'Pop out' })).toHaveCount(
        0
      );
      const stage = (await dialog
        .getByRole('img', { name: 'Eve’s desktop' })
        .boundingBox())!;
      expect(stage.width).toBeGreaterThan(1000);
      expect(stage.width / stage.height).toBeCloseTo(16 / 9, 1);
      const box = (await dialog.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(1040);
      await shot(page, `popout-${theme}`);
      expect(errors).toEqual([]);
    });

    test('reconnecting keeps the last picture under the overlay', async ({
      page,
    }) => {
      await open(page, `state=reconnect&width=800&theme=${theme}`);
      await expect(page.getByRole('status')).toHaveText('Reconnecting');
      await expect(page.getByText('Showing the last picture.')).toBeVisible();
      // The dropped connection's picture is still in the stage.
      const kept = page.locator('[data-screen-last-picture]');
      await expect(kept).toHaveCount(1);
      await expect(kept.getByText('Inbox', { exact: true })).toBeAttached();
      expect((await kept.boundingBox())!.width).toBeGreaterThan(300);
      await shot(page, `reconnect-${theme}`);
    });

    test('too many screens: its own end with Try again, no last picture, no Take over', async ({
      page,
    }) => {
      await open(page, `state=toomany&width=800&theme=${theme}`);
      await expect(
        page.getByText('Too many screens are open for this computer')
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Try again' })
      ).toBeVisible();
      await expect(page.getByText('Showing the last picture')).toHaveCount(0);
      await expect(page.getByText('Reconnecting')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Take over/ })).toHaveCount(
        0
      );
      await shot(page, `toomany-${theme}`);
    });

    test('after Stop watching only View screen again is offered', async ({
      page,
    }) => {
      await open(page, `state=stopped&width=800&theme=${theme}`);
      await expect(page.getByRole('status')).toHaveText('Live');
      await page.getByRole('button', { name: 'Stop watching' }).click();
      await expect(page.getByText('You stopped watching')).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'View screen again' })
      ).toBeVisible();
      await expect(page.getByRole('button', { name: /Take over/ })).toHaveCount(
        0
      );
      await shot(page, `stopped-${theme}`);
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

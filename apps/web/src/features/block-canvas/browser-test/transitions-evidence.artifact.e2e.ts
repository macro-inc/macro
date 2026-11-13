import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

/**
 * Captures what every slide transition looks like: a mid-transition frame, a
 * strip of five frames, and one video stepping through all kinds; then the
 * inspector's picker in light and dark at desktop and phone widths. Runs only
 * when `CANVAS_TRANSITION_EVIDENCE_DIR` names the folder to write to.
 */
const directory = process.env.CANVAS_TRANSITION_EVIDENCE_DIR;
test.skip(!directory, 'Set CANVAS_TRANSITION_EVIDENCE_DIR to capture');

const KINDS = [
  'fade',
  'fadeThroughBlack',
  'dissolve',
  'push',
  'cover',
  'uncover',
  'wipe',
  'split',
  'iris',
  'zoom',
  'flip',
  'cube',
  'pan',
  'fly',
  'overview',
  'path',
] as const;
const FRACTIONS = [0.1, 0.3, 0.5, 0.7, 0.9];

const out = (...parts: string[]) => {
  const path = join(directory ?? '.', ...parts);
  mkdirSync(join(path, '..'), { recursive: true });
  return path;
};

async function presentDeck(page: Page) {
  await page.goto('/artifact.html?edit&deck');
  const node = page.locator('[data-canvas-artifact="1"]');
  await node.locator('iframe[data-canvas-artifact-frame]').waitFor();
  await node.hover();
  await node.getByRole('button', { name: 'Present' }).click();
  await expect(
    page.getByTestId('canvas-artifact-presentation-counter')
  ).toHaveText('1 / 4');
}

/** Holds every running animation at `fraction` of its duration. */
const seek = (page: Page, fraction: number) =>
  page.evaluate((at) => {
    for (const animation of document.getAnimations()) {
      const duration = Number(animation.effect?.getTiming().duration ?? 0);
      animation.pause();
      animation.currentTime = duration * at;
    }
  }, fraction);

const finishAll = (page: Page) =>
  page.evaluate(() => {
    for (const animation of document.getAnimations()) animation.finish();
  });

test.use({ viewport: { width: 1280, height: 720 } });

test('captures every transition mid-flight', async ({ page }) => {
  test.setTimeout(240_000);
  await presentDeck(page);
  // Slide 2 to 3 is joined by the arrow, so `path` follows it.
  await page.keyboard.press('ArrowRight');
  const stage = page.locator('[data-canvas-slide-stage]');
  await expect(stage).toHaveAttribute('data-canvas-transition-state', 'idle');

  let forward = true;
  for (const kind of KINDS) {
    await page.evaluate(
      (value) =>
        window.setSlideTransitions?.({ kind: value, durationMs: 4000 }),
      kind
    );
    await page.keyboard.press(forward ? 'ArrowRight' : 'ArrowLeft');
    await expect(stage).toHaveAttribute('data-canvas-transition', kind);
    // Canvas kinds start once the flight's slides have loaded.
    await expect
      .poll(() => page.evaluate(() => document.getAnimations().length))
      .toBeGreaterThan(0);

    const frames: string[] = [];
    for (const fraction of FRACTIONS) {
      await seek(page, fraction);
      const path = out('frames', kind, `${Math.round(fraction * 100)}.png`);
      await page.screenshot({ path });
      frames.push(path);
    }
    await seek(page, 0.5);
    await page.screenshot({ path: out(`${kind}.png`) });
    await finishAll(page);
    await expect(stage).toHaveAttribute('data-canvas-transition-state', 'idle');

    const strip = await page.context().newPage();
    const images = frames
      .map((path) => {
        const data = readFileSync(path).toString('base64');
        return `<img src="data:image/png;base64,${data}">`;
      })
      .join('');
    await strip.setViewportSize({ width: 1600, height: 200 });
    await strip.setContent(
      `<style>body{margin:0;display:flex;gap:4px;background:#111}img{width:316px}</style>${images}`
    );
    await strip.screenshot({ path: out(`${kind}-strip.png`), fullPage: true });
    await strip.close();
    // Step back and forth between slides 2 and 3.
    forward = !forward;
  }
  writeFileSync(out('kinds.txt'), `${KINDS.join('\n')}\n`);
});

test('records every transition at speed', async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: out('video'), size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  await presentDeck(page);
  const stage = page.locator('[data-canvas-slide-stage]');
  let position = 1;
  let step = 1;
  for (const kind of KINDS) {
    await page.evaluate(
      (value) => window.setSlideTransitions?.({ kind: value }),
      kind
    );
    if (position + step < 1 || position + step > 4) step = -step;
    position += step;
    await page.keyboard.press(step > 0 ? 'ArrowRight' : 'ArrowLeft');
    await expect(stage).toHaveAttribute('data-canvas-transition-state', 'idle');
    await page.waitForTimeout(400);
  }
  const video = page.video();
  await context.close();
  if (video) await video.saveAs(out('all-transitions.webm'));
});

for (const theme of ['light', 'dark'] as const) {
  for (const device of ['desktop', 'phone'] as const) {
    test.describe(`${theme} ${device} inspector`, () => {
      test.use(
        device === 'phone'
          ? {
              viewport: { width: 390, height: 844 },
              hasTouch: true,
              isMobile: true,
            }
          : { viewport: { width: 1280, height: 900 } }
      );

      test('captures the transition picker', async ({ page }) => {
        await page.goto(`/artifact.html?edit&deck&theme=${theme}`);
        const node = page.locator('[data-canvas-artifact="2"]');
        await node.locator('iframe[data-canvas-artifact-frame]').waitFor();
        const box = await node.boundingBox();
        if (!box) throw new Error('Slide 2 is not on screen');
        if (device === 'phone')
          await page.touchscreen.tap(
            box.x + box.width / 2,
            box.y + box.height / 2
          );
        else
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

        const section = page.getByRole('region', { name: 'Transition' });
        await section.scrollIntoViewIfNeeded();
        const tile = section.getByRole('radio', { name: 'Cube' });
        if (device === 'phone') await tile.tap();
        else await tile.click();
        if (device === 'desktop')
          await section.getByRole('radio', { name: 'Fly' }).hover();
        await section.getByRole('button', { name: 'Preview' }).click();
        await expect(
          section.locator('[data-canvas-transition-preview]')
        ).toBeVisible();
        await page.waitForTimeout(300);
        await section.screenshot({
          path: out('inspector', `${theme}-${device}.png`),
        });
        await page.screenshot({
          path: out('inspector', `${theme}-${device}-page.png`),
        });
      });
    });
  }
}

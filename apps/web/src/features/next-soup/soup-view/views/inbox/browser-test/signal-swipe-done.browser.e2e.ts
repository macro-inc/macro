import { type CDPSession, expect, type Page, test } from '@playwright/test';

const PAGE =
  '/src/features/next-soup/soup-view/views/inbox/browser-test/signal-swipe-done.html';

type Frame = {
  phase: string | null;
  /** The row's whole card, divider included. */
  card: number | null;
  /** The part of the card that folds. */
  swipe: number | null;
};

declare global {
  interface Window {
    __signalDone: string[];
    __frames: Frame[];
    __sampling: boolean;
  }
}

/** Block every request off this machine; the fixture's list is in memory. */
async function stayLocal(page: Page) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (!loopback && !['data:', 'blob:'].includes(url.protocol)) ||
      url.pathname.startsWith('/__macro_dev/')
    ) {
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
}

/** A document's swipe row; rows are keyed by occurrence, as in HomeList. */
const row = (page: Page, id: string) =>
  page.locator(`[data-swipe-row][data-swipe-id="row|${id}"]`);

async function openList(page: Page, search = '') {
  await stayLocal(page);
  await page.goto(`${PAGE}${search}`);
  // The first load pre-bundles the app's dependencies.
  await expect(row(page, 'doc-retro')).toBeVisible({ timeout: 180_000 });
}

/** Swipe a row left past the done threshold and lift the finger. */
async function swipeLeft(page: Page, cdp: CDPSession, id: string) {
  const box = await row(page, id).boundingBox();
  if (!box) throw new Error(`${id} is not laid out`);
  const y = box.y + box.height / 2;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 320, y }],
  });
  for (let x = 300; x >= 160; x -= 20) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

/** Heights of the cards in the list that are neither shown nor gone. */
const slivers = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-swipe-row]')]
      .map((swipe) => ({
        id: swipe.dataset.swipeId,
        height: swipe.parentElement?.getBoundingClientRect().height ?? 0,
      }))
      .filter((card) => card.height < 10)
  );

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

test('a row swiped done folds away with its divider', async ({ page }) => {
  await openList(page);
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(() => {
    window.__frames = [];
    window.__sampling = true;
    const sample = () => {
      const swipe = document.querySelector<HTMLElement>(
        '[data-swipe-row][data-swipe-id="row|doc-notes"]'
      );
      window.__frames.push({
        phase: swipe?.dataset.swipePhase ?? null,
        card: swipe?.parentElement?.getBoundingClientRect().height ?? null,
        swipe: swipe?.getBoundingClientRect().height ?? null,
      });
      if (window.__sampling) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await swipeLeft(page, cdp, 'doc-notes');
  await expect(row(page, 'doc-notes')).toHaveCount(0);
  const frames = await page.evaluate(() => {
    window.__sampling = false;
    return window.__frames;
  });

  // The row folded over several frames, and its divider never outlasted it.
  const folding = frames.filter((frame) => frame.phase === 'collapsing');
  expect(folding.length).toBeGreaterThanOrEqual(3);
  for (const frame of frames) {
    if (frame.card === null || frame.swipe === null) continue;
    expect(frame.card - frame.swipe).toBeLessThan(0.5);
  }
  expect(await page.evaluate(() => window.__signalDone)).toEqual(['doc-notes']);
  await cdp.detach();
});

test('rows swiped done in a row leave no lines behind, and a kept row unfolds', async ({
  page,
}) => {
  await openList(page, '?keep=doc-notes');
  const kept = row(page, 'doc-notes');
  const fullHeight = (await kept.boundingBox())?.height ?? 0;
  expect(fullHeight).toBeGreaterThan(40);
  const cdp = await page.context().newCDPSession(page);

  // Each swipe starts while the one before is still folding.
  await swipeLeft(page, cdp, 'doc-plan');
  await swipeLeft(page, cdp, 'doc-notes');
  await swipeLeft(page, cdp, 'doc-budget');
  await expect
    .poll(() => page.evaluate(() => window.__signalDone.length))
    .toBe(3);

  await expect(row(page, 'doc-plan')).toHaveCount(0);
  await expect(row(page, 'doc-budget')).toHaveCount(0);
  // The row the list kept is back at rest and full height, content in place.
  await expect(kept).toHaveAttribute('data-swipe-phase', 'idle');
  await expect
    .poll(async () => (await kept.boundingBox())?.height)
    .toBeCloseTo(fullHeight, 0);
  await expect
    .poll(() =>
      kept.evaluate(
        (swipe) =>
          swipe.getBoundingClientRect().left -
          (swipe.querySelector('[data-swipe-content]')?.getBoundingClientRect()
            .left ?? Number.NaN)
      )
    )
    .toBe(0);
  expect(await slivers(page)).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('after.png') });
  await cdp.detach();
});

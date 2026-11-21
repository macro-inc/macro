import { writeFile } from 'node:fs/promises';
import { type CDPSession, expect, type Page, test } from '@playwright/test';
import { stayLocal } from './stay-local';

const PAGE =
  '/src/features/notifications-inbox/browser-test/notifications-view.html';

const DONE_ID = 'dm-leo';
const NEXT_ID = 'dm-mara';

type Sample = {
  at: number;
  /** The first watched card's height, or null once it has left the DOM. */
  height: number | null;
  phase: string | null;
  /** How far the first watched card's content sits left of the card. */
  contentOffset: number | null;
  /** The other watched cards' heights. */
  others: (number | null)[];
  nextTop: number;
};

declare global {
  interface Window {
    __inboxDone: { id: string; at: number }[];
    __samples: Sample[];
    __sampling: boolean;
  }
}

/** Record the cards a done takes and the row below them on every frame. */
async function startSampling(
  page: Page,
  watch: readonly string[],
  nextId: string
) {
  await page.evaluate(
    ({ watch, nextId }) => {
      window.__samples = [];
      window.__sampling = true;
      const card = (id: string | undefined) =>
        document.querySelector<HTMLElement>(
          `[data-swipe-row][data-swipe-id="${id}"]`
        );
      const sample = () => {
        const row = card(watch[0]);
        const content = row?.querySelector('[data-swipe-content]');
        const next = document.querySelector(
          `[data-swipe-row][data-swipe-id="${nextId}"]`
        );
        const rowBox = row?.getBoundingClientRect();
        window.__samples.push({
          at: performance.now(),
          height: rowBox ? rowBox.height : null,
          phase: row?.dataset.swipePhase ?? null,
          contentOffset:
            rowBox && content
              ? rowBox.left - content.getBoundingClientRect().left
              : null,
          others: watch
            .slice(1)
            .map((id) => card(id)?.getBoundingClientRect().height ?? null),
          nextTop: next?.getBoundingClientRect().top ?? Number.NaN,
        });
        if (window.__sampling) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    },
    { watch, nextId }
  );
}

async function stopSampling(page: Page): Promise<Sample[]> {
  return page.evaluate(() => {
    window.__sampling = false;
    return window.__samples;
  });
}

/** Swipe a row left past the done threshold and lift the finger. */
async function swipeLeft(page: Page, cdp: CDPSession, id: string) {
  const box = await page
    .locator(`[data-swipe-row][data-swipe-id="${id}"]`)
    .boundingBox();
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

/** Save the page's frames while `during` runs, as a strip of JPEGs. */
async function recordFrames(
  cdp: CDPSession,
  name: string,
  during: () => Promise<void>
) {
  const frames: Buffer[] = [];
  const acks: Promise<unknown>[] = [];
  const onFrame = (frame: { data: string; sessionId: number }) => {
    frames.push(Buffer.from(frame.data, 'base64'));
    acks.push(
      cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId })
    );
  };
  cdp.on('Page.screencastFrame', onFrame);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70 });
  await during();
  await cdp.send('Page.stopScreencast');
  cdp.off('Page.screencastFrame', onFrame);
  await Promise.all(acks);
  await Promise.all(
    frames.map((frame, index) =>
      writeFile(
        test
          .info()
          .outputPath(`${name}-frame-${String(index).padStart(3, '0')}.jpg`),
        frame
      )
    )
  );
}

async function openInbox(page: Page, search = '') {
  await stayLocal(page);
  await page.goto(`${PAGE}${search}`);
  // The first load pre-bundles the app's dependencies.
  await expect(
    page.locator(`[data-swipe-row][data-swipe-id="${NEXT_ID}"]`)
  ).toBeVisible({ timeout: 180_000 });
  expect(await page.evaluate(() => window.innerWidth)).toBe(390);
}

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

test('a row swiped done folds away before it leaves, and undo brings it back', async ({
  page,
}) => {
  await openInbox(page);
  const done = page.locator(`[data-swipe-row][data-swipe-id="${DONE_ID}"]`);
  const next = page.locator(`[data-swipe-row][data-swipe-id="${NEXT_ID}"]`);
  const fullHeight = (await done.boundingBox())?.height ?? 0;
  const nextTopBefore = (await next.boundingBox())?.y ?? 0;
  expect(fullHeight).toBeGreaterThan(40);
  await page.screenshot({ path: test.info().outputPath('before.png') });

  const cdp = await page.context().newCDPSession(page);
  await startSampling(page, [DONE_ID], NEXT_ID);
  await recordFrames(cdp, 'swipe-done', async () => {
    await swipeLeft(page, cdp, DONE_ID);
    await expect(done).toHaveCount(0);
    // A few frames after it leaves, to see the rows below settle.
    await page.waitForTimeout(150);
  });
  const samples = await stopSampling(page);
  await page.screenshot({ path: test.info().outputPath('after.png') });

  // The row stays in the DOM, collapsing over several frames, before the
  // feed is asked to drop it.
  const folding = samples.filter(
    (sample) =>
      sample.height !== null &&
      sample.height > 2 &&
      sample.height < fullHeight - 2 &&
      sample.phase === 'collapsing'
  );
  expect(folding.length).toBeGreaterThanOrEqual(3);
  const heights = folding.map((sample) => sample.height ?? 0);
  expect(heights).toEqual([...heights].sort((a, b) => b - a));
  const [taken] = await page.evaluate(() => window.__inboxDone);
  expect(taken?.id).toBe(DONE_ID);
  const lastFolding = folding.at(-1);
  expect(taken?.at).toBeGreaterThanOrEqual(lastFolding?.at ?? Infinity);

  // Its content stays swiped off while it folds; it never snaps back.
  for (const sample of folding) {
    expect(sample.contentOffset ?? 0).toBeGreaterThan(300);
  }

  // The row below slides up into its place, without a jump.
  const tops = samples
    .map((sample) => sample.nextTop)
    .filter((top) => !Number.isNaN(top));
  for (let index = 1; index < tops.length; index += 1) {
    const step = (tops[index - 1] ?? 0) - (tops[index] ?? 0);
    expect(step).toBeGreaterThanOrEqual(-1);
    expect(step).toBeLessThan(fullHeight * 0.6);
  }
  const nextTopAfter = (await next.boundingBox())?.y ?? 0;
  expect(nextTopBefore - nextTopAfter).toBeCloseTo(fullHeight, 0);

  // Undo brings the row back at full height, above the row below.
  await page.getByRole('button', { name: 'Undo last done' }).click();
  await expect(done).toBeVisible();
  await expect
    .poll(async () => (await done.boundingBox())?.height)
    .toBeCloseTo(fullHeight, 0);
  await expect
    .poll(async () => (await next.boundingBox())?.y)
    .toBeCloseTo(nextTopBefore, 0);
  await expect(done).toHaveAttribute('data-swipe-phase', 'idle');
  await cdp.detach();
});

test('with reduced motion a row swiped done leaves without folding', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openInbox(page);
  const done = page.locator(`[data-swipe-row][data-swipe-id="${DONE_ID}"]`);
  const fullHeight = (await done.boundingBox())?.height ?? 0;

  const cdp = await page.context().newCDPSession(page);
  await startSampling(page, [DONE_ID], NEXT_ID);
  await swipeLeft(page, cdp, DONE_ID);
  await expect(done).toHaveCount(0);
  const samples = await stopSampling(page);

  const folding = samples.filter(
    (sample) =>
      sample.height !== null &&
      sample.height > 2 &&
      sample.height < fullHeight - 2
  );
  expect(folding).toEqual([]);
  expect((await page.evaluate(() => window.__inboxDone))[0]?.id).toBe(DONE_ID);
  await cdp.detach();
});

test('the last two notifications of an unfolded stack fold away together', async ({
  page,
}) => {
  await openInbox(page);
  await page
    .locator('#dm-stack')
    .getByRole('button', { name: /notifications/i })
    .click();
  const first = page.locator(
    '[data-swipe-row][data-swipe-id="dm-stack/dm-stack-1"]'
  );
  const second = page.locator(
    '[data-swipe-row][data-swipe-id="dm-stack/dm-stack-2"]'
  );
  await expect(second).toBeVisible();
  const itemHeight = (await first.boundingBox())?.height ?? 0;
  expect(itemHeight).toBeGreaterThan(30);

  const cdp = await page.context().newCDPSession(page);
  await startSampling(
    page,
    ['dm-stack/dm-stack-1', 'dm-stack/dm-stack-2'],
    DONE_ID
  );
  await swipeLeft(page, cdp, 'dm-stack/dm-stack-1');
  await expect(first).toHaveCount(0);
  await expect(second).toHaveCount(0);
  const samples = await stopSampling(page);

  // Both cards fold together: the stack now lists as its row alone.
  const folding = samples.filter(
    (sample) =>
      sample.phase === 'collapsing' &&
      (sample.height ?? 0) > 2 &&
      (sample.height ?? 0) < itemHeight - 2
  );
  expect(folding.length).toBeGreaterThanOrEqual(3);
  for (const sample of folding) {
    const other = sample.others[0] ?? 0;
    expect(other).toBeLessThan(itemHeight - 2);
  }
  const [taken] = await page.evaluate(() => window.__inboxDone);
  expect(taken?.id).toBe('dm-stack-1');
  expect(taken?.at).toBeGreaterThanOrEqual(folding.at(-1)?.at ?? Infinity);
  await expect(page.locator('#dm-stack')).toContainText('Second of two');
  await cdp.detach();
});

test('a row the feed keeps through its done unfolds again, at rest', async ({
  page,
}) => {
  await openInbox(page, `?keep=${DONE_ID}`);
  const done = page.locator(`[data-swipe-row][data-swipe-id="${DONE_ID}"]`);
  const fullHeight = (await done.boundingBox())?.height ?? 0;

  const cdp = await page.context().newCDPSession(page);
  await swipeLeft(page, cdp, DONE_ID);
  await expect
    .poll(() => page.evaluate(() => window.__inboxDone.length))
    .toBe(1);
  await expect(done).toHaveAttribute('data-swipe-phase', 'idle');
  await expect
    .poll(async () => (await done.boundingBox())?.height)
    .toBeCloseTo(fullHeight, 0);
  await expect
    .poll(() =>
      done.evaluate(
        (row) =>
          row.getBoundingClientRect().left -
          (row.querySelector('[data-swipe-content]')?.getBoundingClientRect()
            .left ?? Number.NaN)
      )
    )
    .toBe(0);
  expect((await page.evaluate(() => window.__inboxDone))[0]?.id).toBe(DONE_ID);
  await cdp.detach();
});

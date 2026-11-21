import { type CDPSession, expect, type Page, test } from '@playwright/test';

const fixture = '/src/components/view-shell/browser-test/toast-frame-cost.html';
// About as many elements as a long channel keeps mounted.
const MESSAGES = 400;

/** How many elements a trace event's style pass touched, or undefined for other events. */
function stylePassElements(event: unknown): number | undefined {
  if (typeof event !== 'object' || event === null) return undefined;
  if (!('name' in event) || event.name !== 'UpdateLayoutTree') return undefined;
  if (!('ph' in event) || event.ph !== 'X') return undefined;
  const args = 'args' in event ? event.args : undefined;
  const count =
    typeof args === 'object' && args !== null && 'elementCount' in args
      ? args.elementCount
      : undefined;
  if (typeof count !== 'number')
    throw new Error('A style pass in the trace has no element count');
  return count;
}

function stylePasses(events: unknown[]) {
  return events.map(stylePassElements).filter((count) => count !== undefined);
}

/** Resolves once every CSS animation and transition on the page has ended. */
function settle(page: Page) {
  return page.evaluate(() =>
    Promise.all(document.getAnimations().map((animation) => animation.finished))
  );
}

async function trace(page: Page, run: () => Promise<void>) {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  const events: unknown[] = [];
  cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value));
  await cdp.send('Tracing.start', {
    transferMode: 'ReportEvents',
    traceConfig: {
      includedCategories: [
        'devtools.timeline',
        'disabled-by-default-devtools.timeline',
      ],
    },
  });
  await run();
  const complete = new Promise((resolve) =>
    cdp.once('Tracing.tracingComplete', resolve)
  );
  await cdp.send('Tracing.end');
  await complete;
  await cdp.detach();
  return events;
}

test.use({ viewport: { width: 1440, height: 900 } });

// The desktop stack's height changes in every frame of a toast's entrance,
// exit, and the older card tucking. Anything that follows it with a custom
// property on <html> restyles every element of the page in each of those
// frames (25 ms a frame in a channel). Count style passes, not milliseconds:
// a whole-page pass touches the page's thousands of elements, a toast's own
// pass a few dozen.
test('a toast animating over a heavy page restyles only the toasts', async ({
  page,
}) => {
  // A dev server serving a heavy page to a busy machine.
  test.setTimeout(120_000);
  await page.goto(`${fixture}?messages=${MESSAGES}`);
  await expect(page.locator('article')).toHaveCount(MESSAGES);
  const pageElements = await page.evaluate(
    () => document.getElementsByTagName('*').length
  );
  const toasts = page.locator('[data-macro-toast]');
  const show = page.getByRole('button', { name: 'Show toast', exact: true });
  const dismiss = page.getByRole('button', { name: 'Dismiss toasts' });

  // Warm up the toast modules so the trace holds only the animations.
  await show.click();
  await expect(toasts).toHaveCount(1);
  await dismiss.click();
  await expect(toasts).toHaveCount(0);

  // The detector sees a whole-page pass: a custom property written on <html>.
  const control = await trace(page, async () => {
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          document.documentElement.style.setProperty('--probe', '1px');
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        })
    );
  });
  expect(
    stylePasses(control).filter((count) => count > pageElements / 4)
  ).not.toEqual([]);

  const events = await trace(page, async () => {
    await show.click();
    await expect(toasts).toHaveCount(1);
    await settle(page);
    // A second notice tucks the first behind it.
    await show.click();
    await expect(toasts).toHaveCount(2);
    await settle(page);
    await dismiss.click();
    await expect(toasts).toHaveCount(0);
    await settle(page);
  });

  const passes = stylePasses(events);
  // The animations ran: style passes in their frames.
  expect(passes.length).toBeGreaterThan(5);
  const pageWide = passes.filter((count) => count > pageElements / 4);
  expect(pageWide).toEqual([]);
});

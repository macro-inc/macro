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
  return typeof count === 'number' ? count : 0;
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
// exit, and the older card tucking. Publishing it on <html> restyled every
// element of the page in each of those frames (25 ms a frame in a channel),
// and the toast's own measurement then forced that pass synchronously. Count
// style passes, not milliseconds: a whole-page pass touches the page's
// thousands of elements, a toast's own pass a few dozen.
test('a toast animating over a heavy page restyles only the toasts and what follows them', async ({
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
  const follower = page.getByTestId('inset-follower');
  const show = page.getByRole('button', { name: 'Show toast', exact: true });
  const dismiss = page.getByRole('button', { name: 'Dismiss toasts' });
  const inset = (element: 'follower' | 'root') =>
    page.evaluate(
      (which) =>
        (which === 'root'
          ? document.documentElement
          : document.querySelector<HTMLElement>(
              '[data-testid="inset-follower"]'
            )!
        ).style.getPropertyValue('--desktop-toast-inset-bottom'),
      element
    );

  // Warm up the toast modules so the trace holds only the animations.
  await show.click();
  await expect(toasts).toHaveCount(1);
  await dismiss.click();
  await expect(toasts).toHaveCount(0);

  const events = await trace(page, async () => {
    await show.click();
    await page.waitForTimeout(500);
    // A second notice tucks the first behind it.
    await show.click();
    await expect(toasts).toHaveCount(2);
    await page.waitForTimeout(500);
    // The control above the stack still follows it.
    const raised = await follower.boundingBox();
    expect(await inset('follower')).toMatch(
      /^calc\(\d+(\.\d+)?px \+ 1\.25rem\)$/
    );
    expect(await inset('root')).toBe('');
    await dismiss.click();
    await expect(toasts).toHaveCount(0);
    await page.waitForTimeout(400);
    expect(await inset('follower')).toBe('0px');
    expect((await follower.boundingBox())!.y).toBeGreaterThan(raised!.y);
  });

  const passes = events
    .map(stylePassElements)
    .filter((count) => count !== undefined);
  // The animations ran: a style pass for most of their frames.
  expect(passes.length).toBeGreaterThan(20);
  const pageWide = passes.filter((count) => count > pageElements / 4);
  expect(pageWide).toEqual([]);
});

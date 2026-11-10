import { type Browser, expect, type Page, test } from '@playwright/test';
import { captureView, type ViewCapture } from './capture';
import { PARITY_VIEWS, type ParityView } from './views';

const ORIGINS = {
  baseline: process.env.PARITY_BASELINE_URL,
  branch: process.env.PARITY_BRANCH_URL,
};
const LOGIN_EMAIL = process.env.PARITY_LOGIN_EMAIL;
const STORAGE_STATE = process.env.PARITY_STORAGE_STATE;
const SELECTED = process.env.PARITY_VIEWS?.split(',');

type Side = keyof typeof ORIGINS;

type OpenSide = { page: Page; errors: string[] };

async function signIn(page: Page, origin: string) {
  if (!LOGIN_EMAIL) return;

  // A local stack signs a seeded persona in from this link without a code.
  await page.goto(
    `${origin}/app/login?email=${encodeURIComponent(LOGIN_EMAIL)}`,
    { waitUntil: 'commit' }
  );
  await expect(page).not.toHaveURL(/\/app\/(welcome|signup|login)/);
}

async function openSide(
  browser: Browser,
  side: Side,
  view: ParityView
): Promise<OpenSide> {
  const origin = ORIGINS[side];
  if (!origin) throw new Error(`PARITY_${side.toUpperCase()}_URL is not set`);

  const { viewport, hasTouch, isMobile } = test.info().project.use;
  const context = await browser.newContext({
    viewport,
    hasTouch,
    isMobile,
    ignoreHTTPSErrors: true,
    reducedMotion: 'reduce',
    storageState: STORAGE_STATE,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  try {
    // A dev build serves thousands of modules, so wait on content, not `load`.
    await signIn(page, origin);
    await page.goto(`${origin}/app${view.path}`, { waitUntil: 'commit' });
    await view.ready(page);
  } catch (error) {
    await page.screenshot({
      path: test.info().outputPath(`${view.id}-${side}-did-not-open.png`),
    });
    throw error;
  }

  return { page, errors };
}

async function capture(side: Side, open: OpenSide, name: string) {
  const { page, errors } = open;
  await page.screenshot({
    path: test.info().outputPath(`${name}-${side}.png`),
  });
  return captureView(page, errors);
}

const views = PARITY_VIEWS.filter(
  (view) => !SELECTED || SELECTED.includes(view.id)
);

for (const view of views) {
  test(view.id, async ({ browser }) => {
    test.skip(
      !ORIGINS.baseline || !ORIGINS.branch,
      'Set PARITY_BASELINE_URL and PARITY_BRANCH_URL; see README.md'
    );

    const baseline = await openSide(browser, 'baseline', view);
    const branch = await openSide(browser, 'branch', view);
    const touch = test.info().project.use.hasTouch === true;

    const states = [{ name: 'open', go: async () => {} }, ...view.states];
    for (const state of states) {
      await state.go(baseline.page);
      await state.go(branch.page);

      const name = `${view.id}-${state.name}`;
      const expected: ViewCapture = await capture('baseline', baseline, name);
      const actual: ViewCapture = await capture('branch', branch, name);

      // A capture taken with the wrong device profile proves nothing.
      expect(actual.touch, `${name}: touch detection`).toEqual({
        pointerCoarse: touch,
        attribute: String(touch),
      });
      expect(actual, name).toEqual(expected);
    }
  });
}

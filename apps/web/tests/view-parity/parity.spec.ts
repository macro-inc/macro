import {
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  test,
} from '@playwright/test';
import { splitContainerSelector } from '../../src/lib/core/dom-selectors';
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

type OpenSide = {
  side: Side;
  page: Page;
  errors: string[];
  /** Rejects when the browser drops the page's requests; see README.md. */
  networkChanged: Promise<never>;
};

type SignedInState = Awaited<ReturnType<BrowserContext['storageState']>>;

// One sign-in per build: the auth service limits code checks per address, and
// every view opens a fresh context on each build.
const signedIn = new Map<Side, SignedInState>();

async function signIn(browser: Browser, side: Side, origin: string) {
  if (STORAGE_STATE) return STORAGE_STATE;
  if (!LOGIN_EMAIL) return undefined;

  const known = signedIn.get(side);
  if (known) return known;

  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  // A local stack signs a seeded persona in from this link without a code.
  await page.goto(
    `${origin}/app/login?email=${encodeURIComponent(LOGIN_EMAIL)}`,
    { waitUntil: 'commit' }
  );
  await expect(page).not.toHaveURL(/\/app\/(welcome|signup|login)/);
  await expect(page.locator(splitContainerSelector).first()).toBeVisible();

  const state = await context.storageState();
  await context.close();
  signedIn.set(side, state);
  return state;
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
    storageState: await signIn(browser, side, origin),
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const networkChanged = new Promise<never>((_, reject) => {
    page.on('requestfailed', (request) => {
      if (request.failure()?.errorText !== 'net::ERR_NETWORK_CHANGED') return;

      reject(
        new Error(
          `${side}: Chromium dropped requests (net::ERR_NETWORK_CHANGED), so the page is incomplete`
        )
      );
    });
  });
  // Only a state in progress listens; without this an idle rejection is unhandled.
  networkChanged.catch(() => {});

  // A dev build serves thousands of modules, so wait on content, not `load`.
  await page.goto(`${origin}/app${view.path}`, { waitUntil: 'commit' });

  return { side, page, errors, networkChanged };
}

async function screenshot(open: OpenSide, name: string) {
  await open.page.screenshot({
    path: test.info().outputPath(`${name}-${open.side}.png`),
  });
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

    const states = [{ name: 'open', go: view.ready }, ...view.states];
    for (const state of states) {
      const name = `${view.id}-${state.name}`;

      try {
        for (const open of [baseline, branch]) {
          await Promise.race([state.go(open.page), open.networkChanged]);
        }
      } finally {
        // Kept for a state that never arrived, and for what a diff cannot judge.
        await screenshot(baseline, name);
        await screenshot(branch, name);
      }

      const expected: ViewCapture = await captureView(
        baseline.page,
        baseline.errors
      );
      const actual: ViewCapture = await captureView(branch.page, branch.errors);

      // A capture taken with the wrong device profile proves nothing.
      expect(actual.touch, `${name}: touch detection`).toEqual({
        pointerCoarse: touch,
        attribute: String(touch),
      });
      expect(actual, name).toEqual(expected);
    }
  });
}

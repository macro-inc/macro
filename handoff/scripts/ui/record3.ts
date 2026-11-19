// Records the review check-in request drafted through New routine → Draft it,
// reviewed in the editor and saved; then the hero task moved to In Review on its
// own page, which fires the routine, and what that run scheduled. On the branch
// (MODE=after, EDIT=1) it also opens the scheduled copy (due three days later),
// edits the definition on the parent, shows the edit on the copy, and runs the copy.
// nix develop --command bun record3.ts   (env MODE=before|after VIEW=desktop|phone EDIT=1)
import { mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from '$HOME/.herdr/worktrees/macro/synoet-routines-draft-subroutines/node_modules/playwright/index.mjs';

const BASE = 'https://localhost:28609';
const DIR = '$HOME/.cache/routines-draft-subroutines/ui';
const MODE = process.env.MODE ?? 'after';
const VIEW = process.env.VIEW ?? 'desktop';
const EDIT = process.env.EDIT === '1';
const TEXT =
  process.env.TEXT ??
  'Whenever a task in the Website Redesign project moves to In review, check on it three days later and tell me if it is still in review.';
const TASK = '5eed0185-3c61-8245-b37f-4903682569c2'; // Rewrite the homepage hero copy (seeded)
const NAME = `${MODE}-${VIEW}`;
const OUT = `${DIR}/rec4-${NAME}`;
mkdirSync(OUT, { recursive: true });
const phone = VIEW === 'phone';
const size = phone ? { width: 390, height: 844 } : { width: 1280, height: 800 };
let shot = 0;
const started = Date.now();
const facts: Record<string, unknown> = { mode: MODE, view: VIEW, text: TEXT };
const log = (...args: unknown[]) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s]`, ...args);
const snap = async (page: Page, name: string, fullPage = false) => {
  const path = `${OUT}/${String(++shot).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path, fullPage });
  log('shot', path);
};
const pause = (page: Page, ms = 1500) => page.waitForTimeout(ms);
// On touch the routine page's floating top bar takes no taps (main's
// ViewShell top bar is pointer-events-none and its Run now / tab islands
// don't opt back in), so on the phone its controls are pressed from the
// keyboard: focused, then Enter.
const press = async (page: Page, target: ReturnType<Page['getByRole']>) => {
  if (!phone) return target.click();
  await target.focus();
  await page.keyboard.press('Enter');
};

/** Waits until the runs list shows a finished latest run. */
async function waitForRun(page: Page, limitMs: number): Promise<string> {
  const list = page.getByRole('list', { name: 'Routine runs' });
  const until = Date.now() + limitMs;
  let last = '';
  while (Date.now() < until) {
    const text = (await list.innerText().catch(() => '')).replace(/\s+/g, ' ');
    if (text !== last) log('runs:', text.slice(0, 200));
    last = text;
    if (/Succeeded|Failed|Cancel|Skipped/i.test(text) && !/Running|Queued|Starting|In progress/i.test(text)) return text;
    await page.waitForTimeout(1000);
  }
  return last;
}

/** Scrolls `text` into view and holds there for the video. */
async function show(page: Page, text: string | RegExp, ms = 2000): Promise<boolean> {
  const target = page.getByText(text).first();
  const found = await target.scrollIntoViewIfNeeded({ timeout: 5000 }).then(() => true).catch(() => false);
  await pause(page, ms);
  return found;
}

async function openRunsTab(page: Page) {
  await press(page, page.getByRole('tab', { name: /^Runs/ })).catch(async () => {
    await page.getByText('Runs', { exact: true }).first().click().catch(() => {});
  });
  await pause(page);
}

async function openOverviewTab(page: Page) {
  await press(page, page.getByRole('tab', { name: /^Overview/ }).first()).catch(() => {});
  await pause(page);
}

/** Runs the routine on screen now and waits for the run to finish. */
async function runNow(page: Page, label: string): Promise<string> {
  const runStarted = Date.now();
  await press(page, page.getByRole('button', { name: 'Run now' }).first());
  await openRunsTab(page);
  const runs = await waitForRun(page, 300_000);
  log(`${label} run finished in ${((Date.now() - runStarted) / 1000).toFixed(0)}s: ${runs.slice(0, 160)}`);
  facts[`${label}Run`] = runs.slice(0, 300);
  return runs;
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--ignore-certificate-errors'] });
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  storageState: `${DIR}/riley.json`,
  viewport: size,
  ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  colorScheme: 'dark',
  recordVideo: { dir: OUT, size },
});
const page = await context.newPage();
page.setDefaultTimeout(30_000);
try {
  await page.goto(`${BASE}/app/routines`);
  await page.getByRole('button', { name: 'Create Routine' }).first().waitFor();
  await pause(page);
  await page.getByRole('button', { name: 'Not now' }).click({ timeout: 2000 }).catch(() => {});
  await page.getByRole('button', { name: 'Create Routine' }).first().click();
  const box = page.getByRole('textbox', { name: 'Describe your routine' });
  await box.click();
  await box.pressSequentially(TEXT, { delay: 6 });
  await pause(page, 800);
  await snap(page, 'request');
  const draftStarted = Date.now();
  await page.getByRole('button', { name: 'Draft it' }).click();
  const createButton = page.getByRole('button', { name: 'Create routine', exact: true });
  await createButton.waitFor({ timeout: 300_000 });
  for (let waited = 0; !(await createButton.isEnabled()) && waited < 300; waited++) await page.waitForTimeout(1000);
  facts.draftSeconds = Math.round((Date.now() - draftStarted) / 1000);
  log(`drafted in ${facts.draftSeconds}s`);
  await pause(page, 2500);
  await snap(page, 'drafted');

  // Open the code of every code step, so the video shows what each does.
  const menus = page.getByRole('button', { name: 'Step actions' });
  const count = await menus.count();
  for (let i = 0; i < count; i++) {
    await menus.nth(i).scrollIntoViewIfNeeded().catch(() => {});
    await menus.nth(i).click().catch(() => {});
    const showCode = page.getByRole('menuitem', { name: 'Show code' });
    if (await showCode.isVisible({ timeout: 1500 }).catch(() => false)) {
      await showCode.click();
      log(`showed code of step ${i + 1}`);
    } else {
      await page.keyboard.press('Escape');
    }
  }
  await pause(page, 1000);
  // Walk down the drafted routine one screen at a time.
  const body = await page.locator('main').first().innerText().catch(() => '');
  facts.draftedText = body.slice(0, 6000);
  facts.hasDefinitions = /Sub-routines/.test(body);
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, size.height * 0.7);
    await pause(page, 1300);
    await snap(page, `review-${i + 1}`);
    const atBottom = await page.evaluate(() => {
      const scroller = [...document.querySelectorAll('*')].find(
        (el) => el.scrollHeight > el.clientHeight + 10 && getComputedStyle(el).overflowY !== 'visible' && el.clientHeight > 300,
      );
      return scroller ? scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4 : true;
    });
    if (atBottom) break;
  }
  if (facts.hasDefinitions) {
    await show(page, 'Scheduled once per item by this routine’s runs', 2500);
    await snap(page, 'definition');
  }

  await page.getByRole('button', { name: 'Create routine', exact: true }).click();
  await page.waitForURL((url) => /\/app\/routines\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith('/new'), { timeout: 60_000 });
  const parentUrl = page.url();
  facts.parentUrl = parentUrl;
  log('saved', parentUrl);
  await pause(page, 2500);
  await snap(page, 'saved');

  facts.savedText = (await page.locator('main').first().innerText().catch(() => '')).slice(0, 3000);

  // Move the hero task to In Review on its own page: the change the routine watches.
  await page.goto(`${BASE}/app/task/${TASK}`);
  await pause(page, 3000);
  await page.getByRole('button', { name: 'Not now' }).click({ timeout: 2000 }).catch(() => {});
  const status = page.getByRole('button', { name: /In Progress/i }).first();
  await status.click();
  await pause(page, 1200);
  await snap(page, 'status-menu');
  const firedAt = Date.now();
  await page.getByText('In Review', { exact: true }).first().click();
  await pause(page, 2500);
  await snap(page, 'in-review');
  facts.statusAfterClick = (await page.getByRole('button', { name: /In Review/i }).first().innerText().catch(() => '')).trim();
  log('task moved:', facts.statusAfterClick);

  // Back on the routine, the change starts a run.
  await page.goto(parentUrl);
  await pause(page, 2500);
  await openRunsTab(page);
  const runs = await waitForRun(page, 300_000);
  facts.parentRun = runs.slice(0, 300);
  log(`parent run finished ${((Date.now() - firedAt) / 1000).toFixed(0)}s after the change: ${runs.slice(0, 160)}`);
  await snap(page, 'ran');
  await page.getByRole('list', { name: 'Routine runs' }).getByRole('button').first().click().catch(() => {});
  await pause(page, 2500);
  await snap(page, 'run-detail');
  const created = page.getByRole('region', { name: 'Created' });
  facts.createdInRun = await created.getByRole('button').count();
  log('created in run:', facts.createdInRun);
  // The run may have opened its agent session; come back to the routine.
  if (!page.url().startsWith(parentUrl)) await page.goto(parentUrl);
  await pause(page, 2500);

  await openOverviewTab(page);
  const listed = await show(page, 'Created by this routine', 2500);
  await snap(page, 'created-by');
  if (!listed) {
    log('no Created by this routine section');
  } else {
    const section = page.getByRole('region', { name: 'Created by this routine' });
    const items = section.getByRole('button');
    const itemCount = await items.count();
    facts.createdByText = (await section.innerText().catch(() => '')).slice(0, 2000);
    log('created by:', String(facts.createdByText).replace(/\s+/g, ' ').slice(0, 300));
    // The first row that opens a routine, not the section's toggles.
    let opened = false;
    for (let i = 0; i < itemCount && !opened; i++) {
      const label = (await items.nth(i).innerText().catch(() => '')).trim();
      if (!label || /Show|Hide/.test(label)) continue;
      await items.nth(i).click();
      opened = true;
    }
    if (opened) {
      await page.waitForURL((url) => url.href !== parentUrl, { timeout: 15_000 }).catch(() => {});
      await pause(page, 3000);
      const copyUrl = page.url();
      facts.copyUrl = copyUrl;
      log('copy', copyUrl);
      await snap(page, 'copy');
      await show(page, /^Runs “|Given/, 2000);
      await page.mouse.wheel(0, size.height * 0.6);
      await pause(page, 2000);
      await snap(page, 'copy-steps');
      facts.copyText = (await page.locator('main').first().innerText().catch(() => '')).slice(0, 4000);

      if (EDIT) {
        // Edit the definition on its parent's page.
        await page.getByRole('button', { name: /^Edit in / }).click();
        await page.waitForURL((url) => url.href.startsWith(parentUrl), { timeout: 15_000 });
        await pause(page, 2500);
        await show(page, 'Scheduled once per item by this routine’s runs', 1500);
        const definitions = page.locator('[role=group]').filter({ has: page.getByText('Each one is given') });
        const definition = definitions.first();
        const agent = definition.getByRole('group').filter({ has: page.getByRole('button', { expanded: false }) }).last();
        const header = agent.getByRole('button', { expanded: false }).first();
        const open = await definition.locator('[contenteditable=true]').last().isVisible().catch(() => false);
        if (!open && (await header.isVisible().catch(() => false))) await header.click();
        await pause(page, 1000);
        const editor = definition.locator('[contenteditable=true]').last();
        await editor.scrollIntoViewIfNeeded();
        await editor.click();
        await page.keyboard.press('Control+Home');
        await page.keyboard.type('Start the message with “Heads up:”. ', { delay: 25 });
        await pause(page, 800);
        await snap(page, 'definition-edited');
        await page.getByRole('status').filter({ hasText: /^Saved$/ }).first().waitFor({ timeout: 30_000 }).catch(() => log('no Saved status seen'));
        await pause(page, 2000);
        await snap(page, 'definition-saved');

        // The copy that hasn't run shows the edit, and runs it.
        await page.goto(copyUrl);
        await pause(page, 3500);
        await show(page, 'Heads up', 2500);
        await snap(page, 'copy-after-edit');
        facts.copyAfterEditText = (await page.locator('main').first().innerText().catch(() => '')).slice(0, 4000);
        await runNow(page, 'copy');
        await page.getByRole('list', { name: 'Routine runs' }).getByRole('button').first().click().catch(() => {});
        await pause(page, 4000);
        await snap(page, 'copy-ran');
        facts.copyRunDetail = (await page.locator('body').innerText().catch(() => '')).slice(0, 4000);
      }
    }
  }
  await pause(page, 1500);
} catch (error) {
  log('failed:', error);
  facts.error = String(error);
  await snap(page, 'failed').catch(() => {});
} finally {
  await context.close();
  await browser.close();
  const video = readdirSync(OUT).find((file) => file.endsWith('.webm') && file !== `${NAME}.webm`);
  if (video) renameSync(`${OUT}/${video}`, `${OUT}/${NAME}.webm`);
  writeFileSync(`${OUT}/facts.json`, JSON.stringify(facts, null, 2));
  log('video', `${OUT}/${NAME}.webm`);
}

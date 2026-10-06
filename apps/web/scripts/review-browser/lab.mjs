import { chromium } from 'playwright';

export async function lab(port, options = {}) {
  const origin = process.env.REVIEW_ORIGIN || 'http://localhost:3004';
  const browser = await chromium.connectOverCDP(
    process.env.REVIEW_BROWSER_ENDPOINT || 'http://localhost:9222'
  );
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ['clipboard-read', 'clipboard-write'],
    storageState: process.env.REVIEW_STORAGE_STATE,
    ...options,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let failCommentAfterSave = false;
  const writes = [];
  await page.route('**/agent-sessions/*/review**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const path = url.pathname.slice(url.pathname.indexOf('/review'));
    const response = await fetch(
      `http://localhost:${port}${path}${url.search}`,
      {
        method: request.method(),
        headers: { 'Content-Type': 'application/json' },
        body: request.postData() || undefined,
      }
    );
    const body = Buffer.from(await response.arrayBuffer());
    if (path.endsWith('/comment')) {
      writes.push(JSON.parse(request.postData()));
      if (failCommentAfterSave) {
        failCommentAfterSave = false;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'Test transport lost the response after the save',
          }),
        });
        return;
      }
    }
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body,
    });
  });
  const api = async (path, body) => {
    const response = await fetch(
      `http://localhost:${port}${path}`,
      body
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        : undefined
    );
    const value = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(value));
    return value;
  };
  const open = async (query = '') => {
    await page.goto(
      `${origin}/app/debug/agent-review-integration${query}`,
      { waitUntil: 'domcontentloaded', timeout: 60000 }
    );
    try {
      await page
        .locator('[data-review-integration]')
        .waitFor({ timeout: 60000 });
    } catch (error) {
      throw new Error(
        `${error.message}\nBrowser errors: ${errors.join('; ')}\nPage: ${(await page.locator('body').innerText()).slice(0, 2000)}`
      );
    }
  };
  return {
    context,
    page,
    root: page.locator('[data-review-integration]:not(:has([inert])), [role="dialog"]:has(section[aria-label="Code review"])'),
    errors,
    writes,
    api,
    open,
    failNextCommentResponse: () => {
      failCommentAfterSave = true;
    },
  };
}
export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function openSearch(root) {
  if (await root.getByRole('textbox', { name: 'Find in file', exact: true }).isVisible()) return;
  const label = await root.locator('[data-review-scroll]').getAttribute('aria-label');
  const path = label.replace('Code changes in ', '');
  await root.locator(`[data-review-file=${JSON.stringify(path)}]`)
    .getByRole('button', { name: 'Find in file (/)', exact: true }).click();
}

/** Walk the real virtualized navigation rather than adding a test-only file picker. */
export async function openFile(root, page, path) {
  const toggle = root.getByRole('button', { name: 'Review navigation', exact: true });
  if (await toggle.isVisible() && !(await root.locator('aside').isVisible())) await toggle.click();
  await root.getByText('Walkthrough', { exact: true }).first().click();
  const scroller = root.locator('[data-review-navigation-scroll]');
  await scroller.evaluate(el => { el.scrollTop = 0; });
  let revealed = false;
  for (;;) {
    await page.waitForTimeout(40);
    const button = root.getByRole('button', { name: path, exact: true }).first();
    if (await button.count()) { await button.click(); return; }
    const chapter = scroller.locator('[data-review-chapter][aria-expanded="false"]').first();
    if (await chapter.count()) { await chapter.click(); continue; }
    const next = await scroller.evaluate(el => {
      const before = el.scrollTop;
      el.scrollTop += el.clientHeight * 0.8;
      return el.scrollTop > before;
    });
    if (!next) {
      const hidden = root.getByRole('button', { name: /^Show .+ \(\d+ files\)$/ });
      if (!revealed && await hidden.count()) {
        revealed = true;
        while (await hidden.count()) await hidden.first().click();
        await scroller.evaluate((el) => { el.scrollTop = 0; });
        continue;
      }
      throw new Error(`File not found in walkthrough: ${path}`);
    }
  }
}

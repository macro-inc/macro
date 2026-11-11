import { writeFileSync } from 'node:fs';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { installBrowserHooks } from './browser-hooks';

// Network responses are fixture facts; menu, search parser and editor stay real.
// Close the actual picker before shared Save diagnostics, including on failure.
test.afterEach(async ({ page }) => {
  if (await page.getByRole('searchbox', { name: 'Search GIFs' }).count()) {
    await page.keyboard.press('Escape');
  }
});
installBrowserHooks('/?gifs');

const QUERIES = new WeakMap<Page, string[]>();
const DOWNLOADS = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const queries: string[] = [];
  const downloads: string[] = [];
  QUERIES.set(page, queries);
  DOWNLOADS.set(page, downloads);
  let failedSearch = false;
  await page.route('https://api.klipy.com/v2/*?*', async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get('q') ?? '';
    queries.push(query);
    expect(url.searchParams.get('limit')).toBe('30');
    if (query === 'fail' && !failedSearch) {
      failedSearch = true;
      await route.fulfill({
        status: 503,
        headers: { 'access-control-allow-origin': '*' },
        body: 'Unavailable',
      });
      return;
    }
    const results =
      query === 'empty'
        ? []
        : [1, 2, 3, 4].map((id) => ({
            id: `fixture-${id}`,
            title: `${query || 'Trending'} animation ${id}`,
            media_formats: {
              mediumgif: {
                url: `https://example.test/gif-${id}.gif`,
                dims: [800, 400],
              },
              tinygif: {
                url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
                dims: [1, 1],
              },
            },
          }));
    await route.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      json: { results },
    });
  });
  await page.route('https://example.test/gif-*.gif', async (route) => {
    downloads.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 403, body: 'Fixture download denied' });
  });
});

async function activate(target: Locator, touch: boolean) {
  if (touch) await target.tap();
  else await target.click();
}
async function openGif(page: Page, touch: boolean) {
  await activate(page.locator('#body'), touch);
  await page.keyboard.type('/gif');
  const choice = page
    .locator('.menu-surface')
    .getByText('GIF', { exact: true });
  await expect(choice).toBeVisible();
  await activate(choice, touch);
  const input = page.getByRole('searchbox', { name: 'Search GIFs' });
  await expect(input).toBeFocused();
  await expect(
    page.getByRole('button', { name: 'Trending animation 1', exact: true })
  ).toBeVisible();
  return input;
}

test('native GIF choice focuses search and Escape returns to the unchanged draft', async ({
  page,
  hasTouch,
}) => {
  const input = await openGif(page, hasTouch);
  const before = await page.locator('#live-state').textContent();
  expect(QUERIES.get(page)).toContain('');
  await expect(input).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(page.locator('#body')).toBeFocused();
  expect(await page.locator('#live-state').textContent()).toBe(before);
  expect(DOWNLOADS.get(page)).toEqual([]);
});

test('search uses current query results and clearing restores trending results', async ({
  page,
  hasTouch,
}) => {
  const input = await openGif(page, hasTouch);
  await input.fill('orbit');
  await expect(
    page.getByRole('button', { name: 'orbit animation 1', exact: true })
  ).toBeVisible();
  expect(QUERIES.get(page)).toContain('orbit');
  await expect(
    page.getByRole('button', { name: 'Trending animation 1', exact: true })
  ).toHaveCount(0);
  await input.fill('');
  await expect(
    page.getByRole('button', { name: 'Trending animation 1', exact: true })
  ).toBeVisible();
  expect(QUERIES.get(page)?.at(-1)).toBe('');
  expect(DOWNLOADS.get(page)).toEqual([]);
});

test('keyboard grid selection downloads the third result and failure preserves the real draft for retry', async ({
  page,
  hasTouch,
}) => {
  const input = await openGif(page, hasTouch);
  const before = await page.locator('#live-state').textContent();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toHaveText(
    "Couldn't insert GIF. Try again."
  );
  expect(DOWNLOADS.get(page)).toEqual(['/gif-3.gif']);
  await expect(input).toBeFocused();
  expect(await page.locator('#live-state').textContent()).toBe(before);
  await activate(
    page.getByRole('button', { name: 'Trending animation 1', exact: true }),
    hasTouch
  );
  await expect
    .poll(() => DOWNLOADS.get(page))
    .toEqual(['/gif-3.gif', '/gif-1.gif']);
  await expect(
    page.getByRole('button', { name: 'Trending animation 1', exact: true })
  ).toBeEnabled();
  expect(await page.locator('#live-state').textContent()).toBe(before);
});

test('failed search retries through the actual menu without changing the draft', async ({
  page,
  hasTouch,
}) => {
  const input = await openGif(page, hasTouch);
  const before = await page.locator('#live-state').textContent();
  await input.fill('fail');
  const retry = page.getByRole('button', { name: 'Try again', exact: true });
  await expect(retry).toBeVisible();
  await activate(retry, hasTouch);
  await expect(
    page.getByRole('button', { name: 'fail animation 1', exact: true })
  ).toBeVisible();
  expect(QUERIES.get(page)?.filter((query) => query === 'fail')).toHaveLength(
    2
  );
  expect(await page.locator('#live-state').textContent()).toBe(before);
  expect(DOWNLOADS.get(page)).toEqual([]);
});

test('empty search results yield Enter without creating media', async ({
  page,
  hasTouch,
}) => {
  const input = await openGif(page, hasTouch);
  const before = await page.locator('#live-state').textContent();
  await input.fill('empty');
  await expect(page.getByText('No GIFs found', { exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(input).toBeVisible();
  expect(DOWNLOADS.get(page)).toEqual([]);
  expect(await page.locator('#live-state').textContent()).toBe(before);
});

test('native outside title activation closes the GIF menu and preserves body content', async ({
  page,
  hasTouch,
}) => {
  const input = await openGif(page, hasTouch);
  const before = await page.locator('#live-state').textContent();
  await activate(page.locator('#title'), hasTouch);
  await expect(input).toHaveCount(0);
  await expect(page.locator('#title')).toBeFocused();
  await page.keyboard.type('Outside title');
  await expect(page.locator('#title')).toHaveText('Outside title');
  expect(await page.locator('#live-state').textContent()).toBe(before);
});

test('readonly entry rejects GIF typing and unlock restores the real menu', async ({
  page,
  hasTouch,
}) => {
  const touch = hasTouch;
  await activate(
    page.getByRole('button', { name: 'Read only', exact: true }),
    touch
  );
  await activate(page.locator('#body'), touch);
  await page.keyboard.type('/gif');
  await expect(page.locator('#body')).toHaveText('');
  await expect(
    page.getByRole('searchbox', { name: 'Search GIFs' })
  ).toHaveCount(0);
  expect(QUERIES.get(page)).toEqual([]);
  await activate(
    page.getByRole('button', { name: 'Editable', exact: true }),
    touch
  );
  await openGif(page, touch);
});

test('capture exact GIF controller DOM and JSON', async ({
  page,
  hasTouch,
}, info) => {
  const captures: unknown[] = [];
  async function capture(stage: string) {
    captures.push(
      await page.evaluate(
        (stage) => ({
          stage,
          model: document.querySelector('#live-state')?.textContent,
          body: document.querySelector('#body')?.outerHTML,
          menus: Array.from(document.querySelectorAll('.menu-surface')).map(
            (element) => element.outerHTML
          ),
        }),
        stage
      )
    );
  }
  const input = await openGif(page, hasTouch);
  await capture('open');
  await input.fill('orbit');
  const choice = page.getByRole('button', {
    name: 'orbit animation 1',
    exact: true,
  });
  await expect(choice).toBeVisible();
  await capture('search');
  await activate(choice, hasTouch);
  await expect(page.getByRole('alert')).toHaveText(
    "Couldn't insert GIF. Try again."
  );
  await expect(choice).toBeEnabled();
  await capture('failed-download');
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(page.locator('#body')).toBeFocused();
  await capture('closed');
  const raw = JSON.stringify(captures, null, 2);
  await info.attach('raw-gif-controller-stages', {
    body: raw,
    contentType: 'application/json',
  });
  if (process.env.OVERLAY_GIF_CAPTURE) {
    writeFileSync(
      `${process.env.OVERLAY_GIF_CAPTURE}/${info.project.name}.json`,
      raw
    );
  }
});

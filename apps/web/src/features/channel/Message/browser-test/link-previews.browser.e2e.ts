import { expect, type Page, test } from '@playwright/test';

const ARTICLE = 'https://news.example.com/2026/11/offline-first';
const GUIDE = 'https://docs.example.org/guide';
const BARE = 'https://bare.example.net';
const MACRO_DOCUMENT =
  'https://dev.macro.com/app/md/0195d2dd-5de9-71f2-9d59-5d9734f1adb7';

const UNFURLS: Record<string, object> = {
  [ARTICLE]: {
    url: ARTICLE,
    title: 'Offline first, without the sync bugs',
    description:
      'What we learned moving a collaborative editor to local-first storage, and the three conflicts that still need a person to resolve them.',
    image_url: 'https://news.example.com/images/offline-first.png',
    favicon_url: 'https://news.example.com/favicon.ico',
  },
  [GUIDE]: {
    url: GUIDE,
    title: 'Getting started guide',
    favicon_url: 'https://docs.example.org/favicon.ico',
  },
  // The service's answer for a page with no metadata.
  [BARE]: { url: BARE, title: BARE },
  // The link's hover card still asks for this.
  [MACRO_DOCUMENT]: { url: MACRO_DOCUMENT, title: 'Macro' },
};

// A 1x1 PNG for preview images and favicons.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaPhfDwAEhgGAeEw0ZQAAAABJRU5ErkJggg==',
  'base64'
);

async function serveFixture(page: Page) {
  // Preview images load with credentials, which a wildcard origin refuses.
  const origin = new URL(test.info().project.use.baseURL ?? '').origin;

  // The messages render over synthetic props; no hosted data is read or
  // written. Unfurls and proxied images are answered here, for the tab a card
  // opens too.
  await page.context().route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname.endsWith('/unfurl/bulk')) {
      const body = request.postDataJSON() as { url_list: string[] };
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          responses: body.url_list.map((link) => UNFURLS[link] ?? null),
        }),
      });
      return;
    }

    if (url.pathname.endsWith('/proxy')) {
      await route.fulfill({
        contentType: 'image/png',
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Credentials': 'true',
          'Cross-Origin-Resource-Policy': 'cross-origin',
        },
        body: PNG,
      });
      return;
    }

    if (url.hostname === 'localhost') {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: '{}',
    });
  });
  await page.context().routeWebSocket('**/*', (socket) => socket.close());

  await page.goto(
    '/src/features/channel/Message/browser-test/link-previews.html'
  );
}

test('a message shows a card for each page it links to', async ({ page }) => {
  await serveFixture(page);

  const article = page.locator('[data-fixture-message="article"]');
  const articleCard = article.locator('[data-message-link-previews] a');
  await expect(articleCard).toHaveCount(1, { timeout: 30_000 });
  await expect(articleCard).toHaveAttribute('href', ARTICLE);
  await expect(articleCard).toContainText('news.example.com');
  await expect(articleCard).toContainText(
    'Offline first, without the sync bugs'
  );
  await expect(articleCard).toContainText('What we learned');
  await expect(articleCard.locator('img')).toHaveCount(2);

  // The guide gets a card, the article it repeats does not get a second one,
  // a page with no metadata gets none, and a Macro link stays a link.
  const several = page.locator('[data-fixture-message="several"]');
  const severalCards = several.locator('[data-message-link-previews] a');
  await expect(severalCards).toHaveCount(2);
  await expect(severalCards.nth(0)).toHaveAttribute('href', GUIDE);
  await expect(severalCards.nth(0)).toContainText('Getting started guide');
  await expect(severalCards.nth(1)).toHaveAttribute('href', ARTICLE);

  // The card fits the message column on a phone as on desktop.
  const card = await articleCard.boundingBox();
  const viewport = page.viewportSize();
  expect(card).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (card && viewport) {
    expect(card.x).toBeGreaterThanOrEqual(0);
    expect(card.x + card.width).toBeLessThanOrEqual(viewport.width);
  }

  await page.screenshot({
    path: test.info().outputPath('link-previews.png'),
    fullPage: true,
  });
});

test('a card opens its page', async ({ page, context }) => {
  await serveFixture(page);

  const card = page
    .locator('[data-fixture-message="article"] [data-message-link-previews] a')
    .first();
  await expect(card).toBeVisible({ timeout: 30_000 });

  const opened = context.waitForEvent('page');
  await card.click();
  const tab = await opened;
  expect(tab.url()).toBe(ARTICLE);
});

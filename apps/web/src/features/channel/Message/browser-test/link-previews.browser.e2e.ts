import { expect, type Page, test } from '@playwright/test';

const ARTICLE = 'https://news.example.com/2026/11/offline-first';
const GUIDE = 'https://docs.example.org/guide';

// A 1x1 PNG for preview images and favicons.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaPhfDwAEhgGAeEw0ZQAAAABJRU5ErkJggg==',
  'base64'
);

async function serveFixture(page: Page) {
  // Preview images load with credentials, which a wildcard origin refuses.
  const origin = new URL(test.info().project.use.baseURL ?? '').origin;

  // The messages render over synthetic props; no hosted data is read or
  // written. Proxied images are answered here, for the tab a card opens too.
  await page.context().route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

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

  // Record whether each message's cards were already in place when its text
  // first appeared: a card added later grows the row under a virtual list.
  await page.addInitScript(() => {
    const firstSeen: Record<string, number> = {};
    Object.assign(window, { linkPreviewsAtFirstRender: firstSeen });
    new MutationObserver(() => {
      for (const row of document.querySelectorAll('[data-fixture-message]')) {
        const id = row.getAttribute('data-fixture-message') ?? '';
        if (id in firstSeen) continue;
        if (!row.querySelector('[data-message-content]')) continue;
        firstSeen[id] = row.querySelectorAll(
          '[data-message-link-previews] a'
        ).length;
      }
    }).observe(document, { childList: true, subtree: true });
  });

  await page.goto(
    '/src/features/channel/Message/browser-test/link-previews.html'
  );
}

test('a message shows its link previews as cards from its first render', async ({
  page,
}) => {
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

  // Cards follow the stored order; a message whose previews are not computed
  // yet shows none.
  const severalCards = page.locator(
    '[data-fixture-message="several"] [data-message-link-previews] a'
  );
  await expect(severalCards).toHaveCount(2);
  await expect(severalCards.nth(0)).toHaveAttribute('href', GUIDE);
  await expect(severalCards.nth(0)).toContainText('Getting started guide');
  await expect(severalCards.nth(1)).toHaveAttribute('href', ARTICLE);
  await expect(
    page.locator('[data-fixture-message="pending"] [data-message-content]')
  ).toBeVisible();
  await expect(
    page.locator(
      '[data-fixture-message="pending"] [data-message-link-previews]'
    )
  ).toHaveCount(0);

  expect(
    await page.evaluate(
      () =>
        (window as unknown as { linkPreviewsAtFirstRender: object })
          .linkPreviewsAtFirstRender
    )
  ).toEqual({ article: 1, several: 2, pending: 0 });

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

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
        firstSeen[id] = row.querySelectorAll('[data-link-preview]').length;
      }
    }).observe(document, { childList: true, subtree: true });
  });

  await page.goto(
    '/src/features/channel/Message/browser-test/link-previews.html'
  );
}

const REMOVE = { name: 'Remove link previews' };

test('a message shows its link previews as cards from its first render', async ({
  page,
}) => {
  await serveFixture(page);

  const article = page.locator('[data-fixture-message="article"]');
  const articleCard = article.locator('[data-link-preview]');
  await expect(articleCard).toHaveCount(1, { timeout: 30_000 });
  const articleTitle = articleCard.getByRole('link');
  await expect(articleTitle).toHaveAttribute('href', ARTICLE);
  await expect(articleTitle).toHaveText('Offline first, without the sync bugs');
  await expect(articleCard).toContainText('news.example.com');
  await expect(articleCard.locator('img')).toHaveCount(2);

  // A long description shows its first lines only.
  const description = articleCard.locator('p');
  await expect(description).toContainText('What we learned');
  const lines = await description.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      shown: element.clientHeight / Number.parseFloat(style.lineHeight),
      cut: element.scrollHeight > element.clientHeight,
    };
  });
  expect(Math.round(lines.shown)).toBe(3);
  expect(lines.cut).toBe(true);

  // Cards follow the stored order; a message whose previews are not computed
  // yet shows none.
  const severalTitles = page
    .locator('[data-fixture-message="several"] [data-link-preview]')
    .getByRole('link');
  await expect(severalTitles).toHaveCount(2);
  await expect(severalTitles.nth(0)).toHaveAttribute('href', GUIDE);
  await expect(severalTitles.nth(0)).toHaveText('Getting started guide');
  await expect(severalTitles.nth(1)).toHaveAttribute('href', ARTICLE);
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
  ).toEqual({ article: 1, several: 2, pending: 0, other: 1 });

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

test("a card's title opens its page", async ({ page, context }) => {
  await serveFixture(page);

  const title = page
    .locator('[data-fixture-message="article"] [data-link-preview]')
    .getByRole('link');
  await expect(title).toBeVisible({ timeout: 30_000 });

  const opened = context.waitForEvent('page');
  await title.click();
  const tab = await opened;
  expect(tab.url()).toBe(ARTICLE);
});

test('the sender removes every preview on their message after confirming', async ({
  page,
  isMobile,
}) => {
  await serveFixture(page);

  const several = page.locator('[data-fixture-message="several"]');
  const cards = several.locator('[data-link-preview]');
  await expect(cards).toHaveCount(2, { timeout: 30_000 });

  // Someone else's message has cards and nothing to remove them with.
  const other = page.locator('[data-fixture-message="other"]');
  await expect(other.locator('[data-link-preview]')).toHaveCount(1);
  await expect(other.getByRole('button', REMOVE)).toHaveCount(0);

  // Every card of the sender's message carries the control: on touch it is
  // always there, with a pointer it shows while the card is hovered.
  const remove = several.getByRole('button', REMOVE);
  await expect(remove).toHaveCount(2);
  const shown = remove.first().locator('xpath=..');
  if (isMobile) {
    await expect(shown).toHaveCSS('opacity', '1');
  } else {
    await expect(shown).toHaveCSS('opacity', '0');
    await cards.first().hover();
    await expect(shown).toHaveCSS('opacity', '1');
  }

  // Cancelling keeps the cards.
  await remove.first().click();
  await expect(page.getByText('Remove link previews?')).toBeVisible();
  await expect(
    page.getByText('Every link preview on this message will be removed')
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('Remove link previews?')).toHaveCount(0);
  await expect(cards).toHaveCount(2);

  await page.screenshot({
    path: test.info().outputPath('link-previews-remove.png'),
    fullPage: true,
  });

  // Confirming removes them all, and only this message's.
  if (!isMobile) await cards.first().hover();
  await remove.first().click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(cards).toHaveCount(0);
  await expect(
    page.locator('[data-fixture-message="article"] [data-link-preview]')
  ).toHaveCount(1);
  await expect(other.locator('[data-link-preview]')).toHaveCount(1);
});

test('holding Shift removes the previews without asking', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Shift is a keyboard shortcut');
  await serveFixture(page);

  const article = page.locator('[data-fixture-message="article"]');
  const card = article.locator('[data-link-preview]');
  await expect(card).toHaveCount(1, { timeout: 30_000 });

  await card.hover();
  await article.getByRole('button', REMOVE).click({ modifiers: ['Shift'] });

  await expect(card).toHaveCount(0);
  await expect(page.getByText('Remove link previews?')).toHaveCount(0);
});

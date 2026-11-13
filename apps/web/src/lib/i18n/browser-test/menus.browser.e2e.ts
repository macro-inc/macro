import { expect, test } from '@playwright/test';
import { LANGUAGES } from '../languages';

test.beforeEach(async ({ page }) => {
  // The app's sockets to Macro's services are closed, never Vite's own: on a
  // cold server a dependency found while the page loads makes Vite re-bundle
  // and ask the page to reload over that socket, and a page that can't is
  // left on 504 "Outdated Optimize Dep" chunks and never reports ready.
  await page.routeWebSocket(
    (url) => url.hostname !== 'localhost',
    (socket) => socket.close()
  );
  await page.route('https://**', (route) => route.abort());
  // A page that never reports ready is only diagnosable from what it logged.
  page.on('pageerror', (error) => console.log(`[page error] ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`[console] ${message.text()}`);
  });
  page.on('requestfailed', (request) =>
    console.log(
      `[request failed] ${request.url()} ${request.failure()?.errorText}`
    )
  );
});

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const state = await page
    .evaluate(() => ({
      lang: document.documentElement.lang,
      ready: document.querySelector('[data-translation-ready]') !== null,
      text: document.body.innerText.slice(0, 300),
    }))
    .catch((error: unknown) => String(error));
  console.log(`[page state] ${JSON.stringify(state)}`);
});

for (const { code } of LANGUAGES) {
  test(`menus fit their labels in ${code}`, async ({ page }) => {
    // A cold dev server compiles the app on first load, which can outlast the
    // page load event; wait for the fixture's own ready marker instead.
    await page.goto(`/src/lib/i18n/browser-test/menus.html?lang=${code}`, {
      waitUntil: 'commit',
    });
    await expect(page.locator('[data-translation-ready]')).toBeAttached({
      timeout: 150_000,
    });
    await expect(page.getByRole('menuitem').first()).toBeVisible();

    // A label is clipped when its text is wider than the space it is given.
    const clipped = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '[role="menu"] *, [data-surface] *'
        ),
      ]
        .filter(
          (label) =>
            getComputedStyle(label).textOverflow === 'ellipsis' &&
            label.scrollWidth > label.clientWidth + 1
        )
        .map((label) => label.textContent?.trim())
        .concat(
          [
            ...document.querySelectorAll<HTMLInputElement>(
              '[data-surface] input[placeholder]'
            ),
          ]
            .filter((input) => {
              const style = getComputedStyle(input);
              const context = document.createElement('canvas').getContext('2d');
              if (!context) return false;
              context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
              const room =
                input.clientWidth -
                parseFloat(style.paddingLeft) -
                parseFloat(style.paddingRight);
              return context.measureText(input.placeholder).width > room + 1;
            })
            .map((input) => input.placeholder)
        )
    );
    await page.screenshot({
      path: test.info().outputPath(`menus-${code}.png`),
      fullPage: true,
    });
    expect(clipped).toEqual([]);
  });
}

import { expect, test } from '@playwright/test';
import { LANGUAGES } from '../languages';

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('https://**', (route) => route.abort());
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

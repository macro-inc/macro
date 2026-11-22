import { expect, type Page, test } from '@playwright/test';

async function open(page: Page) {
  await page.goto('/src/features/database/browser-test/record.html');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  // The phone sheet slides up; measure where it settles.
  await dialog.evaluate((element) =>
    Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished)
    )
  );
}

/** Each element's text, and whether it is cut off or outside the dialog. */
function clipped(page: Page, selector: string) {
  return page.getByRole('dialog').evaluate((dialog, selector) => {
    const bounds = dialog.getBoundingClientRect();
    return [...dialog.querySelectorAll<HTMLElement>(selector)].map(
      (element) => {
        const box = element.getBoundingClientRect();
        return {
          text: element.textContent,
          cut:
            element.scrollWidth > element.clientWidth + 1 ||
            box.left < bounds.left ||
            box.right > bounds.right + 0.5,
        };
      }
    );
  }, selector);
}

for (const [name, viewport, touch] of [
  ['desktop', { width: 1280, height: 720 }, false],
  ['phone', { width: 390, height: 844 }, true],
] as const) {
  test.describe(name, () => {
    test.use({ viewport, hasTouch: touch, isMobile: touch });

    test('shows every related record’s name in full', async ({ page }) => {
      await open(page);
      await expect
        .poll(() => clipped(page, '[data-relation-chip-name]'))
        .toEqual(
          ['Draft landing copy', 'Pick a CRM vendor', 'Review launch plan'].map(
            (text) => ({ text, cut: false })
          )
        );
      await page.screenshot({
        path: test.info().outputPath(`record-${name}.png`),
      });
    });

    test('shows long property names in full', async ({ page }) => {
      await open(page);
      await expect
        .poll(() => clipped(page, '[data-record-field-name]'))
        .toEqual(
          ['Tasks', 'Launch readiness (%)', 'Progress (snapshot)'].map(
            (text) => ({ text, cut: false })
          )
        );
    });
  });
}

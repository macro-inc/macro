import { expect, type Page, test } from '@playwright/test';

async function open(page: Page, query = '') {
  await page.goto(`/src/features/database/browser-test/record.html?${query}`);
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

/** Each shown element's text, and whether it is cut off or outside the dialog. */
function clipped(page: Page, selector: string) {
  return page.getByRole('dialog').evaluate((dialog, selector) => {
    const bounds = dialog.getBoundingClientRect();
    return [...dialog.querySelectorAll<HTMLElement>(selector)]
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => {
        const box = element.getBoundingClientRect();
        return {
          text: element.textContent,
          cut:
            element.scrollWidth > element.clientWidth + 1 ||
            box.left < bounds.left ||
            box.right > bounds.right + 0.5,
        };
      });
  }, selector);
}

/** Where each field's name sits against its value, and its padding in the row. */
function fieldLayout(page: Page) {
  return page.getByRole('dialog').evaluate((dialog) =>
    [...dialog.querySelectorAll<HTMLElement>('[data-record-field]')].map(
      (row) => {
        const name = row
          .querySelector<HTMLElement>('[data-record-field-name]')!
          .getBoundingClientRect();
        const value = row
          .querySelector<HTMLElement>('[data-record-field-value]')!
          .getBoundingClientRect();
        const box = row.getBoundingClientRect();
        const lineHeight = Number.parseFloat(
          getComputedStyle(
            row.querySelector<HTMLElement>('[data-record-field-name]')!
          ).lineHeight
        );
        return {
          lines: Math.round(name.height / lineHeight),
          above: name.bottom <= value.top + 0.5,
          beside: name.right <= value.left + 0.5,
          // A name's row leaves at least as much room under it as above it.
          spaced: box.bottom - name.bottom >= name.top - box.top - 0.5,
        };
      }
    )
  );
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
          [
            'Tasks',
            'Launch readiness (%)',
            'Progress (snapshot)',
            'Launch readiness score (percent)',
          ].map((text) => ({ text, cut: false }))
        );
    });

    test('lays each name out against its value', async ({ page }) => {
      await open(page);
      const layout = await fieldLayout(page);
      for (const field of layout) {
        expect(field.spaced).toBe(true);
        if (name === 'phone') {
          // Stacked: the name above, on one line.
          expect(field).toMatchObject({ lines: 1, above: true });
        } else {
          expect(field.beside).toBe(true);
        }
      }
    });

    test('shows many related records', async ({ page }) => {
      await open(page, 'tasks=many');
      const all = [
        'Draft landing copy',
        'Pick a CRM vendor',
        'Review launch plan',
        'Publish the pricing page',
        'Brief the press list',
        'Update the help center',
        'Run the launch checklist',
        'Hold the launch retro',
      ];
      const chips = () => clipped(page, '[data-relation-chip-name]');
      const more = page.getByRole('button', { name: 'Show 3 more Tasks' });
      if (name === 'phone') {
        // A phone shows five, then a row that opens the rest.
        await expect
          .poll(chips)
          .toEqual(all.slice(0, 5).map((text) => ({ text, cut: false })));
        await page.screenshot({
          path: test.info().outputPath(`record-many-${name}.png`),
        });
        await more.click();
        await expect(more).toBeHidden();
      } else {
        await expect(more).toBeHidden();
      }
      await expect
        .poll(chips)
        .toEqual(all.map((text) => ({ text, cut: false })));
      await page.screenshot({
        path: test.info().outputPath(`record-many-open-${name}.png`),
      });
    });

    test('wraps a long related name and keeps an unavailable one', async ({
      page,
    }) => {
      await open(page, 'tasks=long');
      await expect
        .poll(() => clipped(page, '[data-relation-chip-name]'))
        .toEqual(
          [
            'Draft landing copy',
            'Coordinate the migration of every legacy customer workspace before launch',
            'pre-launch-checklist-v2-final-final-revised-copy',
          ].map((text) => ({ text, cut: false }))
        );
      await page.screenshot({
        path: test.info().outputPath(`record-long-${name}.png`),
      });
      await open(page, 'tasks=unavailable');
      await expect(
        page.getByRole('button', { name: 'Open Unavailable record' })
      ).toBeDisabled();
      await page.screenshot({
        path: test.info().outputPath(`record-unavailable-${name}.png`),
      });
    });
  });
}

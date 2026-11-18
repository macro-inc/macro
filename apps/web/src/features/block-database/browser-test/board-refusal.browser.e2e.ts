import { expect, test } from '@playwright/test';
import { openFixture } from './open-fixture';

for (const host of ['setter', 'query']) {
  for (const width of [1280, 390]) {
    test.describe(`${host} positions at ${width}px`, () => {
      test.use({
        viewport: { width, height: 844 },
        isMobile: width === 390,
        hasTouch: width === 390,
      });
      test('a refused stage move restores the saved card order', async ({
        page,
      }) => {
        await page.route('https://**', (route) => route.abort());
        await page.route('**/__macro_dev/**', (route) => route.abort());
        await openFixture(
          page,
          `/src/features/block-database/browser-test/api.html?boardHost=${host}`
        );
        await page
          .getByRole('button', { name: 'Show board', exact: true })
          .click();
        const open = page.locator('[data-kanban-lane][aria-label="Open lane"]');
        const order = [
          '00000000-0000-0000-0000-000000000011',
          '00000000-0000-0000-0000-000000000010',
        ];
        await expect
          .poll(() =>
            open
              .locator('[data-row-id]')
              .evaluateAll((cards) =>
                cards.map((card) => card.getAttribute('data-row-id'))
              )
          )
          .toEqual(order);
        const saved = await page.getByLabel('Saved positions').textContent();
        const move = page.getByRole('button', {
          name: 'Move First',
          exact: true,
        });
        if (width === 390) await move.tap();
        else {
          await open.locator('[data-row-id]').last().hover();
          await move.click();
        }
        const destination = page.getByRole('menuitem', {
          name: 'Negotiation',
          exact: true,
        });
        if (width === 390) await destination.tap();
        else await destination.click();
        await expect(
          page.locator(
            '[data-kanban-lane][aria-label="Negotiation lane"] [data-row-id]'
          )
        ).toHaveCount(1);
        await expect(page.getByLabel('Saved positions')).toHaveText(saved!);
        await page
          .getByRole('button', { name: 'Refuse move', exact: true })
          .click();
        await expect
          .poll(() =>
            open
              .locator('[data-row-id]')
              .evaluateAll((cards) =>
                cards.map((card) => card.getAttribute('data-row-id'))
              )
          )
          .toEqual(order);
        await expect(page.getByLabel('Saved positions')).toHaveText(saved!);
      });
    });
  }
}

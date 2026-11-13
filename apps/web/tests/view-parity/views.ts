import { expect, type Locator, type Page } from '@playwright/test';

/** A view the two builds must render the same, with the states to compare. */
export type ParityView = {
  id: string;
  /** Path under `/app` the view opens at. */
  path: `/${string}`;
  /** Resolves once the view shows its content. */
  ready: (page: Page) => Promise<void>;
  /** States captured after the first, each compared too. */
  states: { name: string; go: (page: Page) => Promise<void> }[];
};

/** Presses as the device would: a tap on touch, a click otherwise. */
async function press(page: Page, target: Locator) {
  const touch = await page.evaluate(
    () => matchMedia('(pointer: coarse)').matches
  );
  if (touch) await target.tap();
  else await target.click();
}

const firstRow = (page: Page) =>
  page.locator('[data-entity-id]').filter({ visible: true }).first();

/**
 * Add a view here when you split it. Steps use what a person would press, so
 * they run unchanged against the build before the split.
 */
export const PARITY_VIEWS: ParityView[] = [
  {
    id: 'mail',
    path: '/mail',
    ready: async (page) => {
      await expect(firstRow(page)).toBeVisible();
    },
    states: [
      {
        // Desktop opens the thread in the Mail view; touch opens its block.
        name: 'thread',
        go: async (page) => {
          await press(page, firstRow(page));
          await expect(page).toHaveURL(/\/(mail|email)\/[0-9a-f-]{36}/);
          await expect(
            page
              .getByText(/^Reply/)
              .filter({ visible: true })
              .first()
          ).toBeVisible();
        },
      },
    ],
  },
];

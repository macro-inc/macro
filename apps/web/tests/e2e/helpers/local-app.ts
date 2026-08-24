import { expect, type Locator, type Page } from '@playwright/test';
import {
  entityIdSelector,
  soupListContainerSelector,
  splitContainerSelector,
} from '../../../src/lib/core/dom-selectors';

export const LOCAL_E2E = process.env.LOCAL_E2E === 'true';

/**
 * Pin the wide sidebar open before the app loads. Desktop sessions start on the
 * skinny nav rail, where the wide sidebar's rows are not rendered — a test that
 * drives those rows has to ask for them. Call before {@link gotoApp}.
 */
export async function useExpandedSidebar(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('sidebar-state', '"expanded"');
  });
}

export async function gotoApp(page: Page, path: `/${string}`) {
  await page.goto(`/app${path}`);
  await expect(page).not.toHaveURL(/\/app\/(welcome|signup|login)/);
  await expect(page.locator(splitContainerSelector).first()).toBeVisible({
    timeout: 30_000,
  });
}

export async function expectEntityInCurrentList(
  page: Page,
  entityId: string,
  label: string
) {
  const row = page.locator(entityIdSelector(entityId)).first();

  const scroller = page.locator(soupListContainerSelector).first();

  await expect(scroller).toBeVisible({ timeout: 30_000 });

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if ((await row.count()) > 0 && (await row.isVisible())) {
      await expect(row).toContainText(label);
      return;
    }

    await scroller.evaluate((element) => {
      element.scrollBy(0, element.clientHeight * 0.9);
    });
    await page.waitForTimeout(150);
  }

  throw new Error(`Could not find seeded entity ${label} (${entityId})`);
}

export async function fillEditable(locator: Locator, text: string) {
  await expect(locator).toBeVisible({ timeout: 30_000 });
  await locator.fill(text);
}

export function uniqueE2EText(prefix: string): string {
  return `${prefix} ${Date.now()} ${Math.random().toString(36).slice(2)}`;
}

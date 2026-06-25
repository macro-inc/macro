import { expect, type Page, test } from '@playwright/test';

import {
  entityIdSelector,
  soupListContainerSelector,
  splitContainerSelector,
} from '../../packages/core/dom-selectors';
import { localE2ESeed } from './fixtures/local-e2e-seed';
import { gotoApp, LOCAL_E2E } from './helpers/local-app';

const SEARCH_BAR = '[data-soup-search]';
const SEEDED_DOCUMENT = localE2ESeed.smoke.projectRoadmap;

test.skip(
  !LOCAL_E2E,
  'local search state tests require LOCAL_E2E=true and seeded local data'
);

test.describe('local search bar state', () => {
  test.describe.configure({ timeout: 60_000 });

  test('restores the query after opening a result and going back', async ({
    page,
  }) => {
    await gotoApp(page, '/component/search');
    await search(page, SEEDED_DOCUMENT.document_name);

    await openFocusedResult(page);
    await expect(page).not.toHaveURL(/\/component\/search$/);

    await goBack(page);

    await expect(page).toHaveURL(/\/component\/search$/);
    await expectSearchText(page, SEEDED_DOCUMENT.document_name);
    await expectResultVisible(page);
  });

  test('restores the query after opening a result and using the browser back button', async ({
    page,
  }) => {
    await gotoApp(page, '/component/search');
    await search(page, SEEDED_DOCUMENT.document_name);

    await openFocusedResult(page);
    await expect(page).not.toHaveURL(/\/component\/search$/);

    // The browser back button drives the URL->layout reconcile path, distinct
    // from the in-app split history. Going back must walk the split's own
    // history so the search view is restored with its captured text and
    // results, instead of being rebuilt into an empty (soup-feed) view.
    await page.goBack();

    await expect(page).toHaveURL(/\/component\/search$/);
    await expectSearchText(page, SEEDED_DOCUMENT.document_name);
    await expectResultVisible(page);
  });

  test('restores the result on browser forward after a browser back', async ({
    page,
  }) => {
    await gotoApp(page, '/component/search');
    await search(page, SEEDED_DOCUMENT.document_name);

    await openFocusedResult(page);
    await expect(page).not.toHaveURL(/\/component\/search$/);
    const resultUrl = page.url();

    await page.goBack();
    await expect(page).toHaveURL(/\/component\/search$/);
    await expectSearchText(page, SEEDED_DOCUMENT.document_name);

    await page.goForward();
    await expect(page).toHaveURL(resultUrl);
  });

  test('restores the query after switching sidebar views and going back', async ({
    page,
  }) => {
    await gotoApp(page, '/component/search');
    await search(page, SEEDED_DOCUMENT.document_name);

    await page.locator('nav [data-sidebar-link="documents"]').first().click();
    await expect(page).toHaveURL(/\/component\/documents$/);

    await goBack(page);

    await expect(page).toHaveURL(/\/component\/search$/);
    await expectSearchText(page, SEEDED_DOCUMENT.document_name);
  });
});

async function search(page: Page, text: string) {
  const input = page.locator(`${SEARCH_BAR} [contenteditable]`).first();
  await expect(input).toBeVisible({ timeout: 30_000 });
  await input.click();
  await input.pressSequentially(text);

  // Wait for the seeded result so we know the query produced output before we
  // navigate away from the view.
  await expectResultVisible(page);
}

// The seeded result is only rendered when the search is actually executing, so
// asserting it after navigation guards against restoring stale bar text over an
// empty soup feed (not just an empty bar).
async function expectResultVisible(page: Page) {
  await expect(
    page.locator(
      `${soupListContainerSelector} ${entityIdSelector(SEEDED_DOCUMENT.document_id)}`
    )
  ).toBeVisible({ timeout: 30_000 });
}

// A single click in the soup list selects the row; pressing Enter on the
// focused row opens it, which navigates the panel to that entity.
async function openFocusedResult(page: Page) {
  await page.locator(splitContainerSelector).first().focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
}

// In-app history back (the split history is what restores per-entry state;
// the browser back button drives a separate URL-reconcile path).
async function goBack(page: Page) {
  await page.locator(splitContainerSelector).first().focus();
  await page.keyboard.press('Alt+BracketLeft');
}

async function expectSearchText(page: Page, text: string) {
  await expect(page.locator(SEARCH_BAR).first()).toContainText(text, {
    timeout: 10_000,
  });
}

// What the composer says when the local storage drafts sync through cannot
// start: a page whose app files a deploy took away. Without the cache's
// coordinator, only a reload brings storage back; without its engine,
// storage keeps restarting on its own, and the composer speaks up once it
// has stalled.
//
// Gmail only: the banner reads this browser's storage, the same for either
// provider.

import type { Page } from '@playwright/test';
import { body, loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { saw } from './ledger/record';

/** Opens a new email and writes one, as far as this device keeps it. */
async function writeNew(page: Page, subject: string): Promise<void> {
  const to = page.getByRole('combobox').first();
  await expect(body(page)).toBeVisible();
  await to.fill('bob@example.com');
  await to.press('Enter');
  await page.getByPlaceholder(/subject/i).fill(subject);
  await body(page).click();
  await page.keyboard.type('Numbers are in.');
}

/** The composer's banner that the edits wait on this device. */
function waiting(page: Page) {
  return page
    .getByRole('alert')
    .or(page.getByRole('status'))
    .filter({ hasText: 'Saved on this device; waiting to sync' });
}

test.use({ provider: 'GMAIL' });
test.beforeEach(({ page }) => loadAppSteadily(page));

// When this fails, edits that cannot sync because local storage failed to
// start wait on this device without a word: no word that only a reload
// helps and no Reload, or no word once a restarting storage has stalled.
test('a draft says so when the storage it syncs through cannot start', async ({
  page,
  mailbox,
}) => {
  test.setTimeout(240_000);
  const coordinator = /\/cache\.coordinator\.shared-worker-[^/]+\.js$/;
  await page.route(coordinator, (route) =>
    route.fulfill({ status: 404, body: 'Not found' })
  );
  await mailbox.open('/app/mail/new');
  await writeNew(page, 'Stuck here');
  // The worker's failure to load usually tells at once; when the page does
  // not hear of it, the cache gives up after its 60-second connect timeout
  // (COORDINATOR_CONNECT_TIMEOUT_MS).
  await expect(waiting(page)).toContainText(
    'Queued changes are preserved. Update or reload Macro to recover local storage.',
    { timeout: 75_000 }
  );
  await expect(
    waiting(page).getByRole('button', { name: 'Reload', exact: true })
  ).toBeVisible();
  saw('STC-085');

  await page.unroute(coordinator);
  await page.route(/\/cache\.engine-worker-[^/]+\.js$/, (route) =>
    route.fulfill({ status: 404, body: 'Not found' })
  );
  await mailbox.open('/app/mail/new');
  await writeNew(page, 'Restarting');
  // Storage is given 15 seconds of restarting before the composer speaks.
  await expect(waiting(page)).toContainText(
    'Changes stay on this device until draft synchronization resumes.',
    { timeout: 45_000 }
  );
  saw('STC-434');
});

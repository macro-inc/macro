import {
  body,
  composeNew,
  loadAppSteadily,
  routeDraftId,
  watchDraftSaves,
} from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { did, saw } from './ledger/record';

declare global {
  interface Window {
    /** Closes the draft store's open connections; answers how many. */
    closeDraftStoreConnections(): number;
  }
}

test.beforeEach(({ page }) => loadAppSteadily(page));

test.describe('the local draft store', () => {
  // Class draft-local-store-failures: when this fails, a draft store whose
  // IndexedDB connection was closed under the page (as browsers do after
  // long idle periods) stays broken: what is typed next is neither kept on
  // the device nor saved to the server, and is gone after a reload.
  test('text typed after the store lost its connection is saved and survives a reload', async ({
    page,
    mailbox,
  }) => {
    // The page cannot reach the app's connections, so every connection the
    // draft store uses is remembered as it starts a transaction.
    await page.addInitScript(() => {
      const used = new Set<IDBDatabase>();
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (...args) {
        if (this.name.includes('working-copies')) used.add(this);
        return transaction.apply(this, args);
      };
      window.closeDraftStoreConnections = () => {
        for (const database of used) database.close();
        const closed = used.size;
        used.clear();
        return closed;
      };
    });
    const saves = watchDraftSaves(page);
    await composeNew(page, mailbox, {
      to: 'bob@example.com',
      subject: 'Harbour walk',
      body: 'First line.',
    });
    await routeDraftId(page);

    expect(
      await page.evaluate(() => window.closeDraftStoreConnections())
    ).toBeGreaterThan(0);
    await body(page).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Second line.');
    did('AC-022');
    did('AC-911');
    await expect
      .poll(() => saves.at(-1)?.html ?? '')
      .toContain('First line. Second line.');

    await page.reload();
    await expect(body(page)).toContainText('First line. Second line.');
    saw('STC-961');
    saw('STC-970');
    await expect(page.getByText('Draft could not be synced')).toHaveCount(0);
  });
});

// What the composer says when its draft cannot be kept: the service refuses
// a save or a discard for good, this device cannot write or read its copy
// of the draft, or another tab changed that copy meanwhile.
//
// Gmail only: the banner and these notices are the composer's own, over
// this browser's storage and the queued draft writes, the same for either
// provider.

import type { Page } from '@playwright/test';
import {
  body,
  composeNew,
  discardButton,
  draftThreads,
  loadAppSteadily,
  routeDraftId,
} from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { notice } from './harness/send';
import { backfilled, refuseOperation, savedNew } from './harness/states-send2';
import { saw } from './ledger/record';

/** The banner above the composer, by its first line. */
function banner(page: Page, message: string) {
  return page
    .getByRole('alert')
    .or(page.getByRole('status'))
    .filter({ has: page.getByText(message, { exact: true }) });
}

/** Types `text` at the end of the composer's body. */
async function typeMore(page: Page, text: string): Promise<void> {
  await body(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(text);
}

type Breakable = Window & { mend?: () => void };

test.use({ provider: 'GMAIL' });
test.beforeEach(({ page }) => loadAppSteadily(page));

// When this fails, a draft the service refuses for good is dropped without
// a word: neither the refused save nor the composer waiting on it says so.
test('a draft save the service refuses for good says so', async ({
  page,
  mailbox,
}) => {
  await savedNew(page, mailbox, 'Refused numbers');
  await refuseOperation(page, 'SaveEmailDraft', 'saveEmailDraft', {
    message: 'invalid draft',
    code: 'INVALID',
  });
  await typeMore(page, ' More.');
  await expect(notice(page, 'Failed to save draft')).toBeVisible();
  saw('STC-090');
  await expect(notice(page, 'Draft could not be synced')).toBeVisible();
  saw('STC-413');
});

// When this fails, edits this device could not store are lost without a
// word: no notice with the reason, no banner asking to keep the editor
// open, or a Retry that failed again leaves the old advice in place.
test('a draft this device cannot store says so until it can', async ({
  page,
  mailbox,
}) => {
  // A composer mounted again starts with nothing failed, and writes the
  // failed copy again on its way out.
  await backfilled(mailbox);
  await savedNew(page, mailbox, 'Kept here');
  // Storage refuses every write, as a full disk does.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    (window as Breakable).mend = () => {
      IDBObjectStore.prototype.put = put;
    };
    IDBObjectStore.prototype.put = () => {
      throw new DOMException(
        'The quota has been exceeded.',
        'QuotaExceededError'
      );
    };
  });
  await typeMore(page, ' More.');
  // The reason is the browser's own, for a write refused inside a storage
  // transaction.
  const reason = 'Uncaught exception in event handler.';
  const unsaved = notice(page, 'Draft could not be saved on this device');
  await expect(unsaved).toContainText(`AbortError: ${reason}`);
  saw('STC-088');
  const failed = banner(page, 'Changes could not be saved on this device');
  const detail = failed.locator('p').nth(1);
  await expect(detail).toHaveText(
    'Keep this editor open until saving succeeds.'
  );
  await expect(failed.getByRole('button', { name: 'Retry' })).toBeVisible();
  saw('STC-083');

  await failed.getByRole('button', { name: 'Retry' }).click();
  await expect(detail).toHaveText(reason);
  saw('STC-435');

  await page.evaluate(() => (window as Breakable).mend?.());
  await failed.getByRole('button', { name: 'Retry' }).click();
  await expect(failed).toHaveCount(0);
  await expect(unsaved).toHaveCount(0);
});

// When this fails, a draft open in two tabs loses one tab's text without a
// word: a status this tab cannot read passes in silence, or this tab's
// next edit overwrites the other tab's newer text, or fails unexplained.
test('a draft open in two tabs says when this tab is behind', async ({
  page,
  context,
  mailbox,
}) => {
  await savedNew(page, mailbox, 'Two tabs');
  const other = await context.newPage();
  await other.routeWebSocket(/\/connection-gateway(\/|\?|$)/, () => {});
  await other.routeWebSocket(/\/websocket(\/|\?|$)/, () => {});
  await loadAppSteadily(other);
  await other.goto(page.url());
  await expect(body(other)).toContainText('The numbers are in.');

  // This tab can no longer read its storage when the other tab writes.
  await page.evaluate(() => {
    const begin = IDBDatabase.prototype.transaction;
    (window as Breakable).mend = () => {
      IDBDatabase.prototype.transaction = begin;
    };
    IDBDatabase.prototype.transaction = function (
      this: IDBDatabase,
      stores: string | string[],
      mode?: IDBTransactionMode,
      options?: IDBTransactionOptions
    ) {
      if (mode !== 'readwrite')
        throw new DOMException('Storage is unavailable.', 'UnknownError');
      return begin.call(this, stores, mode, options);
    };
  });
  await typeMore(other, ' Newer.');
  const unreadable = banner(page, 'Unable to read local draft status.');
  await expect(unreadable).toContainText('Retry to check the saved draft.');
  await expect(unreadable.getByRole('button', { name: 'Retry' })).toBeVisible();
  saw('STC-086');
  // Mended, the next change the other tab or the service makes may clear
  // the banner before a Retry could; the edit below needs neither.
  await page.evaluate(() => (window as Breakable).mend?.());

  await typeMore(page, ' Older.');
  await expect(
    notice(page, 'Draft could not be saved on this device')
  ).toContainText(
    'This draft changed while saving. Reopen it to use the latest version.'
  );
  saw('STC-089');
  await other.close();
});

// When this fails, a discard the service refused for good leaves a draft
// behind without a word: the composer does not say its discard could not be
// confirmed, or offers no way to discard it again or keep it.
test('a draft whose discard the service refused says so in its composer', async ({
  page,
  mailbox,
}) => {
  const subject = 'Offsite plan';
  await refuseOperation(page, 'DeleteEmailDraft', 'deleteEmailDraft', {
    message: 'invalid draft',
    code: 'INVALID',
  });
  await composeNew(page, mailbox, {
    to: 'grace@example.com',
    subject,
    body: 'Thinking of the coast.',
  });
  await routeDraftId(page);
  await expect
    .poll(async () => (await draftThreads(mailbox)).map((t) => t.name))
    .toEqual([subject]);
  await discardButton(page).click();
  // The refused discard leaves the draft open in its composer.
  await expect(page.getByPlaceholder(/subject/i)).toHaveValue(subject);
  const unconfirmed = banner(page, 'Draft could not be synced');
  await expect(unconfirmed).toContainText('Discard could not be confirmed.');
  await expect(
    unconfirmed.getByRole('button', { name: 'Retry discard', exact: true })
  ).toBeVisible();
  await expect(
    unconfirmed.getByRole('button', { name: 'Keep editing', exact: true })
  ).toBeVisible();
  saw('STC-084', 'F-119');
  saw('STC-084', 'F-120');
});

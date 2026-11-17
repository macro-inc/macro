// What a composer shows while it reads its saved draft back, and when it
// cannot: a new message reopened after a reload and from Drafts, a link to a
// draft this device has no copy of, and a reply reopened in its thread while
// its copy on this device is read, or cannot be read, in place and after a
// reload.
//
// Gmail only: a draft is read back from this browser's own storage and the
// app's cache, the same code whatever the mailbox.

import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import {
  body,
  composeNew,
  graphqlOperation,
  loadAppSteadily,
  routeDraftId,
} from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { replyEditor } from './harness/send';
import { draftStorage, hold } from './harness/states-send1';
import { saw } from './ledger/record';

function loadingDraft(page: Page) {
  return page.getByRole('status').filter({ hasText: 'Loading draft…' });
}

function emailTab(page: Page, name: 'Inbox' | 'Drafts') {
  return page
    .getByRole('navigation', { name: 'Email tabs' })
    .getByRole('button', { name });
}

test.describe('what a composer says while it reads its draft back, Gmail inbox', () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, a new message reopened after a reload or from Drafts
  // shows an empty composer, or nothing, while it is read back, so the user
  // starts over or sends it blank; or a link to a draft this device has no
  // copy of opens an empty composer instead of saying it cannot load.
  test('a new message reopened says it is loading, and one not on this device says it cannot load', async ({
    page,
    mailbox,
  }) => {
    const storage = await draftStorage(page);
    await composeNew(page, mailbox, {
      to: 'grace@example.com',
      subject: 'Trail notes',
      body: 'Notes attached.',
    });
    await routeDraftId(page);

    // The app's cache starts again after the reload; its engine is held.
    const engine = await hold(page, (request) =>
      /\/cache_wasm_bg-[^/]*\.wasm$/.test(new URL(request.url()).pathname)
    );
    await page.reload();
    await expect(loadingDraft(page)).toBeVisible();
    saw('STC-001', 'F-118');
    await engine.release();
    await expect(body(page)).toHaveText('Notes attached.');

    await emailTab(page, 'Drafts').click();
    const row = page.getByRole('main').getByText('Trail notes');
    await expect(row).toBeVisible();
    await storage.holdReads();
    await row.click();
    await expect(loadingDraft(page)).toBeVisible();
    saw('STC-001', 'F-116');
    await storage.release();
    await expect(body(page)).toHaveText('Notes attached.');

    await mailbox.open(`/app/mail/new?s0.email-compose.draft=${randomUUID()}`);
    await expect(
      page.getByRole('alert').filter({ hasText: 'Unable to load this draft.' })
    ).toHaveText('Unable to load this draft. Retry');
    saw('STC-002');
  });

  // When this fails, a reply reopened in its thread shows an empty box, or
  // nothing, while its copy on this device is read back, or when that copy
  // cannot be read, here or after a reload: the user retypes the reply or
  // loses it, and Retry does not bring it back once storage works again.
  test('a reply reopened says it is loading, and that its copy cannot be read until Retry', async ({
    page,
    mailbox,
  }) => {
    const storage = await draftStorage(page);
    await mailbox.deliver({
      from: 'Grace <grace@example.com>',
      subject: 'Lunch?',
      text: 'Noon at the usual?',
    });
    const thread = await mailbox.synced('Lunch?');
    await mailbox.open(`/app/mail/${thread.id}`);
    await page.getByText('Reply...').click();
    const saved = page.waitForResponse(
      (response) =>
        graphqlOperation(response.request()) === 'SaveEmailDraft' &&
        response.ok()
    );
    await replyEditor(page).pressSequentially('Works for me.');
    await saved;
    const lunch = page.getByRole('main').getByText('Lunch?').first();

    await emailTab(page, 'Inbox').click();
    await expect(lunch).toBeVisible();
    await storage.holdReads();
    await lunch.click();
    await expect(loadingDraft(page)).toBeVisible();
    saw('STC-001', 'F-117');
    await storage.release();
    await expect(replyEditor(page)).toContainText('Works for me.');

    await emailTab(page, 'Inbox').click();
    await expect(lunch).toBeVisible();
    await storage.failReads();
    await lunch.click();
    const unreadable = page
      .getByRole('alert')
      .filter({ hasText: 'Unable to load local draft.' });
    await expect(unreadable).toHaveText('Unable to load local draft. Retry');
    saw('STC-003', 'F-117');

    await page.reload();
    await expect(unreadable).toHaveText('Unable to load local draft. Retry');
    saw('STC-003', 'F-118');

    await storage.release();
    await unreadable.getByRole('button', { name: 'Retry' }).click();
    await expect(replyEditor(page)).toContainText('Works for me.');
  });
});

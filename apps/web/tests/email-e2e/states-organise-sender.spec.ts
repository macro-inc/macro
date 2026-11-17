// The notices a row's sender actions raise when the email service refuses
// them: Block Sender and Sender → Noise, and the Undo each offers once it
// worked. On a desktop from the row's context menu, on a phone from the
// drawer a long press opens.
//
// The notices answer the app's own request to the email service, which
// refuses the same way whichever mailbox the sender wrote to; what the
// mailbox then holds is organise-sender's concern. Gmail on the desktop,
// Outlook on the phone, so each mailbox shows them once.

import type { Locator, Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import { notice } from './harness/send';
import { method, noticesGone, refuse } from './harness/states-organise';
import { PHONE } from './harness/ways-list1';
import {
  blocked,
  longPress,
  row,
  senderFilters,
} from './harness/ways-organise';
import { saw } from './ledger/record';

const IDA = 'Ida <ida@example.com>';
const HAL = 'Hal <hal@example.com>';
const BLOCK = '**/email/contacts/block';
const UNBLOCK = '**/email/contacts/unblock';
const FILTERS = '**/email/filters';
const FILTER = '**/email/filters/*';

/** Delivers a thread from each sender and waits for the list to show both. */
async function twoSenders(
  page: Page,
  mailbox: Mailbox
): Promise<{ offers: string; photos: string }> {
  await mailbox.deliver({ from: IDA, subject: 'Offers', text: 'Sale.' });
  await mailbox.deliver({ from: HAL, subject: 'Photos', text: 'Friday.' });
  const offers = (await mailbox.synced('Offers')).id;
  const photos = (await mailbox.synced('Photos')).id;
  await mailbox.open();
  await expect
    .poll(() => rowIds(page))
    .toEqual(expect.arrayContaining([offers, photos]));
  return { offers, photos };
}

test.describe('the notices of a refused sender action on a desktop', () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  const fromMenu = async (page: Page, id: string, item: string) => {
    await row(page, id).click({ button: 'right' });
    await page.getByRole('menu').getByRole('menuitem', { name: item }).click();
  };

  // When this fails, a refused block or a refused unblock from the block's
  // Undo goes unreported (the sender silently stays as it was), or a
  // refused Sender → Noise, or the refused Undo of one, says nothing.
  test('Block Sender and Sender → Noise refused, then their Undo refused', async ({
    page,
    mailbox,
  }) => {
    const { offers, photos } = await twoSenders(page, mailbox);
    let refusing = true;
    await refuse(page, BLOCK, method('POST'), () => refusing);
    await refuse(page, UNBLOCK, method('POST'));
    await refuse(page, FILTERS, method('PUT'), () => refusing);
    await refuse(page, FILTER, method('DELETE'));

    await fromMenu(page, offers, 'Block Sender');
    await expect(notice(page, 'Failed to block sender')).toBeVisible();
    saw('STL-600');
    expect(await blocked(mailbox)).toEqual([]);

    await fromMenu(page, photos, 'Sender → Noise');
    await expect(notice(page, 'Failed to mark sender as Noise')).toBeVisible();
    saw('STL-601');
    expect(await senderFilters(mailbox)).toEqual([]);

    // Each Undo below is pressed with its notice alone on screen.
    await noticesGone(page);
    refusing = false;
    await fromMenu(page, offers, 'Block Sender');
    const queued = notice(page, 'Sender block queued');
    await expect(queued).toBeVisible();
    await expect.poll(() => blocked(mailbox)).toEqual(['ida@example.com']);
    // A notice under the pointer stays until it is done with.
    await queued.hover();
    await queued.getByRole('button', { name: 'Undo' }).click();
    await expect(notice(page, 'Failed to unblock sender')).toBeVisible();
    saw('STL-600');
    expect(await blocked(mailbox)).toEqual(['ida@example.com']);

    await noticesGone(page);
    await fromMenu(page, photos, 'Sender → Noise');
    const marked = notice(page, 'Sender marked as Noise');
    await expect(marked).toBeVisible();
    await marked.hover();
    await marked.getByRole('button', { name: 'Undo' }).click();
    await expect(notice(page, 'Failed to undo')).toBeVisible();
    saw('STL-601');
    expect(await senderFilters(mailbox)).toEqual([
      { address: 'hal@example.com', signal: false },
    ]);
  });
});

test.describe('the notices of a refused sender action on a phone', () => {
  test.use({ ...PHONE, provider: 'OUTLOOK' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  const fromDrawer = async (page: Page, id: string, item: string) => {
    const drawer: Locator = page.getByRole('dialog', {
      name: 'Entity actions',
    });
    await longPress(page, id, drawer);
    await drawer.getByRole('button', { name: item }).tap();
    await expect(drawer).toHaveCount(0);
  };

  // When this fails, the phone's drawer reports none of a refused block, a
  // refused unblock from its Undo, a refused Sender → Noise or the refused
  // Undo of one.
  test('Block Sender and Sender → Noise refused from the drawer, then their Undo refused', async ({
    page,
    mailbox,
  }) => {
    const { offers, photos } = await twoSenders(page, mailbox);
    expect(await page.evaluate(() => window.innerWidth)).toBe(
      PHONE.viewport.width
    );
    let refusing = true;
    await refuse(page, BLOCK, method('POST'), () => refusing);
    await refuse(page, UNBLOCK, method('POST'));
    await refuse(page, FILTERS, method('PUT'), () => refusing);
    await refuse(page, FILTER, method('DELETE'));

    await fromDrawer(page, offers, 'Block Sender');
    await expect(notice(page, 'Failed to block sender')).toBeVisible();
    saw('STL-600');

    await fromDrawer(page, photos, 'Sender → Noise');
    await expect(notice(page, 'Failed to mark sender as Noise')).toBeVisible();
    saw('STL-601');

    refusing = false;
    await fromDrawer(page, offers, 'Block Sender');
    const queued = notice(page, 'Sender block queued');
    await queued.getByRole('button', { name: 'Undo' }).tap();
    await expect(notice(page, 'Failed to unblock sender')).toBeVisible();
    saw('STL-600');

    await fromDrawer(page, photos, 'Sender → Noise');
    const marked = notice(page, 'Sender marked as Noise');
    await marked.getByRole('button', { name: 'Undo' }).tap();
    await expect(notice(page, 'Failed to undo')).toBeVisible();
    saw('STL-601');
    expect(await senderFilters(mailbox)).toEqual([
      { address: 'hal@example.com', signal: false },
    ]);
  });
});

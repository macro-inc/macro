// What a thread's side panel (a sheet on a phone) shows of where the thread
// is mentioned and of what its reader may change, and the selection
// toolbar's Restore and Not spam while they run.
//
// References and access are Macro's, the same whichever mailbox the thread
// is in, and the toolbar's buttons wait on the app's own request to the email
// service: Gmail on the desktop, Outlook on the phone, so each mailbox shows
// them once.

import type { Locator, Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { deliverToSpam, syncedInView } from './harness/journeys';
import { deliverLabelled } from './harness/list';
import { grantView, threadOf } from './harness/sharing';
import type { Provider } from './harness/stack';
import {
  hold,
  mentionInDocument,
  method,
  refuse,
  sidePanel,
  THREAD_STATE,
} from './harness/states-organise';
import { openTouchTab, PHONE } from './harness/ways-list1';
import { listShows, rowCheckbox } from './harness/ways-list2';
import { deliverAll, row } from './harness/ways-organise';
import { toolbarButton } from './harness/ways-organise-more';
import { saw } from './ledger/record';

/** Hugo's Budget, in Bob's inbox, which Bob shared with the signed-in user. */
async function sharedWithMe(
  mailbox: Mailbox,
  provider: Provider
): Promise<string> {
  const bob = await mailbox.stack.user('bob@example.com');
  await mailbox.stack.link(bob, provider);
  await mailbox.stack.deliver('bob@example.com', {
    from: 'Hugo <hugo@example.com>',
    subject: 'Budget',
    text: 'About Budget.',
  });
  const budget = await threadOf(mailbox, 'bob@example.com');
  await grantView(mailbox, budget, mailbox.user);
  return budget;
}

/** The app's answer to which documents and messages mention the thread. */
function referencesRead(page: Page, threadId: string) {
  return page.waitForResponse(
    (response) =>
      response.url().endsWith(`/attachments/thread/${threadId}/references`) &&
      response.ok()
  );
}

/**
 * The panel's References and add controls, for a thread with no reference
 * (Minutes), one a document mentions (Agenda) and one shared with the user
 * (Budget). `open` opens a thread with its panel (a sheet on a phone).
 */
async function panelStates(
  page: Page,
  open: (id: string, text: string) => Promise<Locator>,
  ids: { Agenda: string; Minutes: string; Budget: string }
): Promise<void> {
  const references = (panel: Locator) =>
    panel.getByText(/^References( \(\d+\))?$/);

  let answered = referencesRead(page, ids.Minutes);
  let panel = await open(ids.Minutes, 'About Minutes.');
  // Each section's header has one, and so does its body.
  await expect(
    panel.getByRole('button', { name: 'Add tags' }).first()
  ).toBeVisible();
  await expect(
    panel.getByRole('button', { name: 'Add property' }).first()
  ).toBeVisible();
  await answered;
  await expect(references(panel)).toHaveCount(0);
  saw('STL-620');

  answered = referencesRead(page, ids.Agenda);
  panel = await open(ids.Agenda, 'About Agenda.');
  await answered;
  await expect(references(panel)).toHaveText('References (1)');
  saw('STL-620');

  panel = await open(ids.Budget, 'About Budget.');
  await expect(panel.getByText('Tags', { exact: true })).toBeVisible();
  await expect(panel.getByText('Properties', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Add tags' })).toHaveCount(0);
  saw('STL-621', 'F-084');
  await expect(panel.getByRole('button', { name: 'Add property' })).toHaveCount(
    0
  );
  saw('STL-621', 'F-088');
}

test.describe('the side panel and selection toolbar on a desktop', () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, the panel of a thread a document mentions shows no
  // References (or no count), a thread nothing mentions shows an empty
  // References, or the panel of a thread someone shared offers its reader
  // to add tags or properties.
  test('References only for a thread mentioned elsewhere; a shared thread reads without add controls', async ({
    page,
    mailbox,
  }) => {
    const ids = await deliverAll(mailbox, ['Agenda', 'Minutes']);
    await mentionInDocument(mailbox, ids.Agenda);
    const budget = await sharedWithMe(mailbox, 'GMAIL');
    const panel = sidePanel(page);
    await panelStates(
      page,
      async (id, text) => {
        // A thread opened by its address opens with the panel closed.
        await mailbox.open(`/app/mail/${id}`);
        await expect(page.getByText(text).first()).toBeVisible();
        await page.getByRole('button', { name: 'Show details' }).click();
        await expect(panel).toBeVisible();
        return panel;
      },
      { Agenda: ids.Agenda, Minutes: ids.Minutes, Budget: budget }
    );
  });

  // When this fails, Restore in Trash or Not spam in Spam can be pressed
  // again while its first request is on its way, or stays disabled once
  // that request was refused.
  test('Restore and Not spam are disabled while they run', async ({
    page,
    mailbox,
  }) => {
    await deliverLabelled(
      mailbox,
      { from: 'Ann <ann@example.com>', subject: 'Old invoice', text: 'Paid.' },
      ['TRASH']
    );
    await deliverToSpam(mailbox, {
      from: 'Hal <hal@example.com>',
      subject: 'Team photos',
      text: 'The photos from Friday.',
    });
    const invoice = await syncedInView(mailbox, 'trash', 'Old invoice');
    const photos = await syncedInView(mailbox, 'spam', 'Team photos');
    const library = page.getByRole('navigation', { name: 'Email library' });
    const selected = page.getByText('1 selected', { exact: true });
    // The service client asks again after a refusal: every ask is refused
    // until the test stops it, and the first one is held.
    let refusing = true;
    await refuse(page, THREAD_STATE, method('PATCH'), () => refusing);
    const restoring = await hold(page, THREAD_STATE, method('PATCH'));

    await mailbox.open();
    await library.getByRole('button', { name: 'Trash' }).click();
    await listShows(page, [invoice]);
    await (await rowCheckbox(page, invoice)).click();
    await expect(selected).toBeVisible();
    const restore = toolbarButton(page, 'Restore');
    await restore.click();
    await expect.poll(restoring.held).toBe(1);
    await expect(restore).toBeDisabled();
    saw('STL-607', 'F-076');
    await restoring.release('refuse');
    await expect(restore).toBeEnabled();
    await expect(selected).toBeVisible();
    refusing = false;
    await restore.click();
    await listShows(page, []);

    const reporting = await hold(page, THREAD_STATE, method('PATCH'));
    await library.getByRole('button', { name: 'Spam' }).click();
    await listShows(page, [photos]);
    await (await rowCheckbox(page, photos)).click();
    await expect(selected).toBeVisible();
    const notSpam = toolbarButton(page, 'Not spam');
    await notSpam.click();
    await expect.poll(reporting.held).toBe(1);
    await expect(notSpam).toBeDisabled();
    saw('STL-607', 'F-078');
    await reporting.release();
    await listShows(page, []);
  });
});

test.describe('the details sheet and selection toolbar on a phone', () => {
  test.use({ ...PHONE, provider: 'OUTLOOK' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, the details sheet of a thread a document mentions
  // shows no References (or no count), a thread nothing mentions shows an
  // empty References, or the sheet of a thread someone shared offers its
  // reader to add tags or properties.
  test('References only for a thread mentioned elsewhere; a shared thread reads without add controls', async ({
    page,
    mailbox,
  }) => {
    const ids = await deliverAll(mailbox, ['Agenda', 'Minutes']);
    await mentionInDocument(mailbox, ids.Agenda);
    const budget = await sharedWithMe(mailbox, 'OUTLOOK');
    const sheet = page.getByRole('dialog', { name: 'Item details' });
    await panelStates(
      page,
      async (id, text) => {
        await mailbox.open(`/app/email/${id}`);
        await expect(page.getByText(text).first()).toBeVisible();
        expect(await page.evaluate(() => window.innerWidth)).toBe(
          PHONE.viewport.width
        );
        await page.getByRole('button', { name: 'Show details' }).tap();
        await expect(sheet).toBeInViewport({ ratio: 1 });
        return sheet;
      },
      { Agenda: ids.Agenda, Minutes: ids.Minutes, Budget: budget }
    );
  });

  // When this fails, the phone's Not spam can be pressed again while its
  // first request is on its way.
  test('Not spam is disabled while it runs', async ({ page, mailbox }) => {
    await deliverToSpam(mailbox, {
      from: 'Hal <hal@example.com>',
      subject: 'Team photos',
      text: 'The photos from Friday.',
    });
    const photos = await syncedInView(mailbox, 'spam', 'Team photos');
    const reporting = await hold(page, THREAD_STATE, method('PATCH'));

    await mailbox.open();
    await openTouchTab(page, 'Spam');
    await listShows(page, [photos]);
    await row(page, photos)
      .getByRole('checkbox', { name: 'Select item' })
      .tap();
    await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
    const notSpam = toolbarButton(page, 'Not spam');
    await notSpam.tap();
    await expect.poll(reporting.held).toBe(1);
    await expect(notSpam).toBeDisabled();
    saw('STL-607', 'F-078');
    await reporting.release();
    await listShows(page, []);
  });
});

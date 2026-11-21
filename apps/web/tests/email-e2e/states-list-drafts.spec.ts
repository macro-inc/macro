// What the Drafts and Scheduled tabs show of the user's unsent mail: the
// draft badge on a draft's row, the queued sends above the Drafts list, the
// send time on a scheduled row, and the notice once a draft is discarded
// from the list, or could not be. Each for a Gmail and an Outlook inbox.

import type { Page } from '@playwright/test';
import { composeNew, draftThreads, loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { focusRow } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import { notice } from './harness/send';
import { refuseOperation, sidebarTab } from './harness/states-list';
import { anotherDevice, failOperation } from './harness/states-send2';
import { row } from './harness/ways-list2';
import { did, saw } from './ledger/record';

/** Picks when the open composer sends, in words, from its clock button. */
async function pickSendTime(page: Page, words: string): Promise<void> {
  await page.getByRole('button', { name: /^Choose send time/ }).click();
  await page.getByRole('combobox', { name: /./ }).last().fill(words);
  await page.getByRole('option').first().click();
  did('AC-046');
}

for (const provider of PROVIDERS) {
  test.describe(`the unsent mail of ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a draft's row in Drafts carries no draft badge, the
    // Drafts tab does not list a send queued on this device above the list,
    // a scheduled row in Scheduled does not say when it sends, or
    // discarding a draft from the list raises no notice.
    test('Drafts badges a draft and lists the queued send, Scheduled shows its time, discarding says so', async ({
      page,
      mailbox,
    }) => {
      const stored = async () =>
        (await draftThreads(mailbox)).map((thread) => thread.name);
      await composeNew(page, mailbox, {
        to: 'grace@example.com',
        subject: 'Plan A',
        body: 'Not sure yet.',
      });
      await expect.poll(stored).toContain('Plan A');
      await composeNew(page, mailbox, {
        to: 'grace@example.com',
        subject: 'Plan B',
        body: 'For tomorrow.',
      });
      // Scheduling while the composer still saves its first copy can be lost.
      await expect.poll(stored).toContain('Plan B');
      await pickSendTime(page, 'tomorrow 9am');
      await page
        .getByRole('button', { name: 'Schedule send', exact: true })
        .click();
      did('AC-049');
      await expect(
        page.getByRole('status', { name: 'Email scheduled', exact: true })
      ).toBeVisible();
      const planA = (await draftThreads(mailbox)).find(
        (thread) => thread.name === 'Plan A'
      );
      if (!planA) throw new Error('Plan A is no longer a draft');

      // A send the service cannot be reached for stays queued on this device.
      await failOperation(page, 'SendEmailMessage');
      await composeNew(page, mailbox, {
        to: 'grace@example.com',
        subject: 'Plan C',
        body: 'Right now.',
      });
      // Saved first, so the composer has a thread to show once it sends.
      await expect.poll(stored).toContain('Plan C');
      await page.getByRole('button', { name: 'Send email' }).click();
      await expect(
        page.getByRole('heading', { name: 'Plan C', level: 1 })
      ).toBeVisible();
      await sidebarTab(page, 'Drafts');
      await expect(
        row(page, planA.id).getByText('draft', { exact: true })
      ).toBeVisible();
      saw('STL-029');
      const queued = page.getByLabel('Queued email sends');
      await expect(queued).toContainText('Plan C');
      await expect(queued.getByRole('status')).toHaveText(
        'Checking server acceptance'
      );
      await expect(
        queued.getByRole('button', { name: 'Cancel', exact: true })
      ).toBeEnabled();
      saw('STL-404');

      await sidebarTab(page, 'Scheduled');
      const scheduled = page
        .locator('[data-entity-id]')
        .filter({ hasText: 'Plan B' })
        .getByTitle(/^Scheduled to send /);
      await expect(scheduled).toHaveText('Tomorrow, 9:00 AM');
      saw('STL-031');

      await sidebarTab(page, 'Drafts');
      await focusRow(page, planA.id);
      await page.keyboard.press('Shift+ControlOrMeta+D');
      did('AL-069');
      await expect(notice(page, 'Draft discarded')).toBeVisible();
      saw('STL-053');
      await expect(row(page, planA.id)).toHaveCount(0);
    });
  });
}

// Gmail only: the discard fails on Macro's own read of the thread, before
// anything reaches the provider.
test.describe('a draft written on another device, in a Gmail inbox', () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, discarding from the list a draft whose thread this
  // device cannot read raises no notice, or the row leaves the list as if
  // the draft were gone.
  test('discarding it while its thread cannot be read says it failed', async ({
    page,
    mailbox,
    browser,
  }) => {
    await composeNew(page, mailbox, {
      to: 'grace@example.com',
      subject: 'Plan A',
      body: 'Not sure yet.',
    });
    await expect
      .poll(async () =>
        (await draftThreads(mailbox)).find((thread) => thread.name === 'Plan A')
      )
      .toBeDefined();
    const planA = (await draftThreads(mailbox)).find(
      (thread) => thread.name === 'Plan A'
    );
    if (!planA) throw new Error('Plan A is no longer a draft');

    // This device holds no copy of the draft, so it must read the thread.
    const other = await anotherDevice(browser, mailbox);
    try {
      await refuseOperation(other.page, 'EmailThreadPage');
      await sidebarTab(other.page, 'Drafts');
      await focusRow(other.page, planA.id);
      await other.page.keyboard.press('Shift+ControlOrMeta+D');
      did('AL-069');
      await expect(notice(other.page, 'Failed to discard draft')).toBeVisible();
      saw('STL-053');
      await expect(row(other.page, planA.id)).toBeVisible();
    } finally {
      await other.close();
    }
  });
});

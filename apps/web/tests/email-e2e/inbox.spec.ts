import type { Page } from '@playwright/test';
import type { Mailbox } from './harness/fixtures';
import { expect, test } from './harness/fixtures';
import { did, saw } from './ledger/record';

const WORK = 'work@example.com';

/** A second inbox for the signed-in user, with one message in each inbox. */
async function twoInboxesWithMail(mailbox: Mailbox) {
  await mailbox.stack.link(mailbox.user, 'GMAIL', WORK);
  await mailbox.deliver({
    from: 'Grace <grace@example.com>',
    subject: 'Lunch?',
    text: 'Noon at the usual place?',
  });
  await mailbox.stack.deliver(WORK, {
    from: 'Linus <linus@example.com>',
    subject: 'Budget',
    text: 'Numbers attached.',
  });
  await mailbox.synced('Lunch?');
  await mailbox.synced('Budget');
}

/** A row of the mail list, by its subject. */
function row(page: Page, subject: string) {
  return page.getByText(subject, { exact: true }).first();
}

/** The checkbox for an inbox in Filters, Inboxes; opens the menus if closed. */
async function inboxCheckbox(page: Page, address: string) {
  const checkbox = page.getByRole('menuitemcheckbox', { name: address });
  if (!(await checkbox.isVisible())) {
    await page.getByRole('button', { name: 'Filter email' }).click();
    did('AL-018');
    await page.getByRole('menuitem', { name: 'Inboxes' }).click();
  }
  await expect(checkbox).toBeVisible();
  return checkbox;
}

test.describe('choosing which inboxes the mail list shows', () => {
  // Class inbox-selection-ui: unchecking the last checked inbox means "all
  // inboxes" again. When this fails the list goes empty ("No inboxes
  // selected") although the person only removed a filter.
  test('unchecking the only checked inbox in Filters shows mail from every inbox again', async ({
    page,
    mailbox,
  }) => {
    await twoInboxesWithMail(mailbox);
    await mailbox.open('/app/mail');
    await expect(row(page, 'Lunch?')).toBeVisible();
    await expect(row(page, 'Budget')).toBeVisible();

    const work = await inboxCheckbox(page, WORK);
    await work.click();
    did('AL-028');
    await expect(work).toBeChecked();
    await expect(row(page, 'Budget')).toBeVisible();
    await expect(row(page, 'Lunch?')).toBeHidden();
    saw('STL-967');

    await (await inboxCheckbox(page, WORK)).click();
    await expect(await inboxCheckbox(page, WORK)).not.toBeChecked();
    await expect(row(page, 'Lunch?')).toBeVisible();
    await expect(row(page, 'Budget')).toBeVisible();
    await expect(page.getByText('No inboxes selected')).toBeHidden();
  });

  // Class inbox-selection-ui: picking an inbox in the sidebar's account menu
  // narrows the list to that inbox at once. When this fails the first pick
  // does nothing and the list keeps showing every inbox.
  test('picking an inbox in the sidebar shows only that inbox on the first pick, and All inboxes brings the rest back', async ({
    page,
    mailbox,
  }) => {
    await twoInboxesWithMail(mailbox);
    await mailbox.open('/app/mail');
    await expect(row(page, 'Lunch?')).toBeVisible();
    await expect(row(page, 'Budget')).toBeVisible();

    await page
      .getByRole('button', { name: 'Select inbox: All inboxes' })
      .click();
    await page.getByRole('menuitemradio', { name: WORK }).click();
    did('AL-038');
    await expect(
      page.getByRole('button', { name: `Select inbox: ${WORK}` })
    ).toBeVisible();
    saw('STL-025');
    await expect(row(page, 'Budget')).toBeVisible();
    await expect(row(page, 'Lunch?')).toBeHidden();
    saw('STL-967');

    await page.getByRole('button', { name: `Select inbox: ${WORK}` }).click();
    await page.getByRole('menuitemradio', { name: 'All inboxes' }).click();
    did('AL-039');
    await expect(row(page, 'Lunch?')).toBeVisible();
    await expect(row(page, 'Budget')).toBeVisible();
  });
});

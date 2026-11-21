// What the phone's composer says when the user backs out of a draft that
// another tab scheduled and asks to delete it.
//
// Gmail only: the composer refuses the same way for either provider.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { notice } from './harness/send';
import {
  returnToTab,
  savedDraft,
  scheduleElsewhere,
} from './harness/states-send2';
import { openPhoneComposer, phone, phoneBody } from './harness/ways-compose1';
import { morningIn, scheduled } from './harness/ways-send';
import { did, saw } from './ledger/record';

test.use({ ...phone, provider: 'GMAIL' });
test.beforeEach(({ page }) => loadAppSteadily(page));

// When this fails, Delete Draft in the phone's Back sheet deletes a draft
// whose schedule still stands (or drops the schedule with it) without a
// word, or does nothing and does not say to cancel the schedule first.
test("the phone's Back sheet will not delete a scheduled draft and says why", async ({
  page,
  mailbox,
}) => {
  const subject = 'Quarter close';
  const text = 'The numbers are in.';
  await openPhoneComposer(page, mailbox);
  const to = page.getByRole('combobox').first();
  await to.fill('grace@example.com');
  await to.press('Enter');
  await page.getByRole('textbox', { name: 'Subject' }).fill(subject);
  await phoneBody(page).tap();
  await page.keyboard.type(text);
  const draft = () => savedDraft(mailbox, { subject }, text);
  await expect.poll(draft, { timeout: 30_000 }).toBeTruthy();
  await scheduleElsewhere(mailbox, (await draft()) as string, morningIn(1));
  await returnToTab(page);
  await expect(
    notice(page, /Email scheduled for .+\. Cancel the schedule to edit\./)
  ).toBeVisible();

  const sheet = page.getByRole('dialog', { name: 'Draft options' });
  await page.getByRole('button', { name: 'Go Back' }).tap();
  await expect(sheet).toBeVisible();
  await expect(sheet).not.toHaveAttribute('data-transitioning');
  await sheet.getByRole('button', { name: 'Delete Draft' }).tap();
  did('AC-062');
  await expect(
    notice(page, 'Cancel the schedule before deleting this draft.')
  ).toBeVisible();
  saw('STC-073');
  expect(await draft()).toBeTruthy();
  expect(await scheduled(mailbox)).toHaveLength(1);
});

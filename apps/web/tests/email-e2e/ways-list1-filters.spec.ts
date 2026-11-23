// The groups of the desktop filter menu that no other test goes through:
// Done, Has, Attachments, Tags, People, Importance, Latest activity, and the
// menu's own "Clear filters". Each is chosen on mail it separates, and the
// list must then show that mail and nothing else. For a Gmail and an Outlook
// inbox.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { deliverNoise, focusRow } from './harness/list';
import { createTag, tagThread } from './harness/organise';
import { anInbox, PROVIDERS } from './harness/providers';
import { notice } from './harness/send';
import { deliverAt } from './harness/sync';
import { threadMessages } from './harness/thread';
import { inFocus, replyAtGmail } from './harness/ways-list-more';
import {
  clearFilters,
  closeMenus,
  deliverInvitation,
  expectRows,
  filterGroup,
  filterSubmenu,
  GRACE,
  HUGO,
  openFilterGroup,
  PDF_FILE,
  PNG_FILE,
  pickFilter,
  row,
} from './harness/ways-list1';
import { did } from './ledger/record';

const DAY = 24 * 60 * 60 * 1000;

for (const provider of PROVIDERS) {
  test.describe(`the filter menu of ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a group of the filter menu that reads what a thread
    // is or holds (Done, Has, Attachments) does not narrow the list to the
    // mail it names, or "Clear filters" leaves the list narrowed.
    test('Done, Has and Attachments each list the mail they name, and Clear filters lists it all again', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from: GRACE, subject: 'Plain', text: 'Hello.' });
      await mailbox.deliver({
        from: GRACE,
        subject: 'Report',
        text: 'The report.',
        attachments: [PDF_FILE],
      });
      await mailbox.deliver({
        from: GRACE,
        subject: 'Photo',
        text: 'The photo.',
        attachments: [PNG_FILE],
      });
      await mailbox.deliver({ from: GRACE, subject: 'Kept', text: 'Keep.' });
      await mailbox.deliver({ from: GRACE, subject: 'Finished', text: 'Ok.' });
      const plain = (await mailbox.synced('Plain')).id;
      const report = (await mailbox.synced('Report')).id;
      const photo = (await mailbox.synced('Photo')).id;
      const kept = (await mailbox.synced('Kept')).id;
      const finished = (await mailbox.synced('Finished')).id;
      // Signal lists what is not done.
      const open = [plain, report, photo, kept];

      await mailbox.open();
      await expectRows(page, [...open, finished]);
      // One thread starred and one marked done, as their keys do.
      await focusRow(page, kept);
      await page.keyboard.press('s');
      await expect(notice(page, 'Added to favorites')).toBeVisible();
      await focusRow(page, finished);
      await page.keyboard.press('e');
      await expect(row(page, finished)).toHaveCount(0);
      await expectRows(page, open);

      await pickFilter(page, 'Done', 'menuitemradio', 'Done');
      did('AL-021');
      await expectRows(page, [finished]);

      await clearFilters(page);
      did('AL-029');
      await expectRows(page, open);
      await expect(filterGroup(page)).not.toHaveText(/\d/);

      await pickFilter(page, 'Has', 'menuitemcheckbox', 'Starred');
      did('AL-022');
      await expectRows(page, [kept]);
      await clearFilters(page);
      await expectRows(page, open);

      await pickFilter(page, 'Attachments', 'menuitemcheckbox', 'PDFs');
      did('AL-023');
      await expectRows(page, [report]);
      await clearFilters(page);
      await expectRows(page, open);

      await pickFilter(page, 'Attachments', 'menuitemcheckbox', 'Images');
      await expectRows(page, [photo]);
      await clearFilters(page);
      await expectRows(page, open);
    });

    // When this fails, Has › Calendar invite drops the thread that carries
    // a calendar part or admits an ordinary message.
    test('Has Calendar invite lists the invitation and nothing else', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from: GRACE, subject: 'Plain', text: 'Hello.' });
      await deliverInvitation(mailbox, 'Invitation: Planning review');
      const plain = (await mailbox.synced('Plain')).id;
      const invite = (await mailbox.synced('Invitation: Planning review')).id;
      await inFocus(mailbox, plain, 'none');
      await inFocus(mailbox, invite, 'none');

      await mailbox.open();
      await expectRows(page, [plain, invite]);

      await pickFilter(page, 'Has', 'menuitemcheckbox', 'Calendar invite');
      did('AL-022');
      await expectRows(page, [invite]);
      await clearFilters(page);
      await expectRows(page, [plain, invite]);

      const views = page.getByRole('radiogroup', { name: 'Inbox view' });
      await views.getByText('Focus', { exact: true }).click();
      await expect(views.getByRole('radio', { name: 'Focus' })).toBeChecked();
      await expectRows(page, [plain, invite]);
      await pickFilter(page, 'Has', 'menuitemcheckbox', 'Calendar invite');
      await expectRows(page, [invite]);
      await clearFilters(page);
      await expectRows(page, [plain, invite]);
    });

    // When this fails, a group of the filter menu that sets a condition of
    // the view (Tags, People, Importance, Latest activity) does not narrow
    // the list to the mail it names.
    test('Tags, People, Importance and Latest activity each list the mail they name', async ({
      page,
      mailbox,
    }) => {
      await deliverNoise(mailbox, {
        from: 'Deals <deals@example.com>',
        subject: 'Sale',
        text: 'Everything must go.',
      });
      await deliverAt(mailbox, {
        from: GRACE,
        subject: 'Old',
        text: 'From last month.',
        date: new Date(Date.now() - 20 * DAY),
      });
      await mailbox.deliver({ from: GRACE, subject: 'Plain', text: 'Hello.' });
      await mailbox.deliver({ from: HUGO, subject: 'From Hugo', text: 'Hi.' });
      await mailbox.deliver({ from: GRACE, subject: 'Tagged', text: 'Now.' });
      const sale = (await mailbox.synced('Sale')).id;
      const old = (await mailbox.synced('Old')).id;
      const plain = (await mailbox.synced('Plain')).id;
      const hugo = (await mailbox.synced('From Hugo')).id;
      const tagged = (await mailbox.synced('Tagged')).id;
      await tagThread(mailbox, tagged, await createTag(mailbox, 'Urgent'));
      const signal = [old, plain, hugo, tagged];

      await mailbox.open();
      await expectRows(page, signal);

      await closeMenus(page);
      await openFilterGroup(page, 'Tags');
      await filterSubmenu(page, 'Tags')
        .getByRole('option', { name: 'Urgent', exact: true })
        .click();
      did('AL-024');
      await expectRows(page, [tagged]);
      await clearFilters(page);
      await expectRows(page, signal);

      // An address typed into People is offered as an entry to add.
      await openFilterGroup(page, 'People');
      const people = filterSubmenu(page, 'People');
      await people.getByRole('combobox').fill('hugo@example.com');
      await people
        .getByRole('option')
        .filter({ hasText: 'hugo@example.com' })
        .first()
        .click();
      did('AL-025');
      await expectRows(page, [hugo]);
      await clearFilters(page);
      await expectRows(page, signal);

      await pickFilter(page, 'Importance', 'menuitemradio', 'Noise');
      did('AL-026');
      await expectRows(page, [sale]);
      await clearFilters(page);
      await expectRows(page, signal);

      await pickFilter(page, 'Latest activity', 'menuitemradio', 'Last 7 days');
      did('AL-027');
      await expectRows(page, [plain, hugo, tagged]);
      await clearFilters(page);
      await expectRows(page, signal);
    });
  });
}

// Gmail only: Focus's flags are what the classifier stored for each thread,
// whatever the provider.
test.describe('the Focus filter of a Gmail inbox', () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, the filter menu's Focus group on the Focus tab does not
  // narrow the list to the threads with that flag (Reply needed, Follow up),
  // or All does not bring the rest back.
  test('Reply needed, Follow up and All each list the Focus threads they name', async ({
    page,
    mailbox,
  }) => {
    await mailbox.deliver({ from: GRACE, subject: 'Question', text: 'Ok?' });
    await mailbox.deliver({
      from: HUGO,
      subject: 'Promise',
      text: 'Can you send it?',
      messageId: 'promise-1@example.com',
    });
    await mailbox.deliver({ from: GRACE, subject: 'Update', text: 'Done.' });
    const question = (await mailbox.synced('Question')).id;
    const promise = (await mailbox.synced('Promise')).id;
    const update = (await mailbox.synced('Update')).id;
    // Follow up is a thread the owner wrote last in, back in Focus because
    // its due day has come (`inFocus` makes it due today).
    await replyAtGmail(mailbox, {
      inReplyTo: 'promise-1@example.com',
      to: 'hugo@example.com',
      subject: 'Re: Promise',
      text: 'I will, on Monday.',
    });
    await expect
      .poll(async () =>
        (await threadMessages(mailbox, promise)).map((m) => m.is_sent)
      )
      .toEqual([false, true]);
    await inFocus(mailbox, question, 'reply');
    await inFocus(mailbox, promise, 'follow-up');
    await inFocus(mailbox, update, 'none');
    const views = page.getByRole('radiogroup', { name: 'Inbox view' });

    await mailbox.open();
    await views.getByText('Focus', { exact: true }).click();
    await expect(views.getByRole('radio', { name: 'Focus' })).toBeChecked();
    await expectRows(page, [question, promise, update]);

    await pickFilter(page, 'Focus', 'menuitemradio', 'Reply needed');
    did('AL-410');
    await expectRows(page, [question]);

    await pickFilter(page, 'Focus', 'menuitemradio', 'Follow up');
    did('AL-410');
    await expectRows(page, [promise]);

    await pickFilter(page, 'Focus', 'menuitemradio', 'All');
    did('AL-410');
    await expectRows(page, [question, promise, update]);
  });
});

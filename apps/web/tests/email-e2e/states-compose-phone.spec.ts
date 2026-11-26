// The touch composer: how the phone folds its recipient, Cc/Bcc/From and
// subject rows, the Draft options sheet of Go Back and the draft it saves,
// and the From it shows once another inbox is chosen.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { anInbox, PROVIDERS } from './harness/providers';
import { phoneRecipientInput } from './harness/ways-compose-more';
import {
  openPhoneComposer,
  phone,
  phoneBody,
  storedDraft,
} from './harness/ways-compose1';
import { openTouchTab } from './harness/ways-list1';
import { saw } from './ledger/record';

const WORK = 'ada.work@example.com';

test.beforeEach(({ page }) => loadAppSteadily(page));

test.describe('the phone composer', () => {
  test.use({ ...phone });

  // When this fails, the phone composer no longer folds the rows nobody is
  // editing (recipients into a summary, Cc/Bcc and From into one row, the
  // subject into one line) or does not fold Cc/Bcc back when they stay
  // empty, Go Back with edits leaves without offering to keep the draft, or
  // Save Draft keeps nothing Drafts can reopen. The layout is the same
  // whatever the provider: Gmail only.
  test('rows fold while not edited, and Go Back offers Draft options whose Save Draft keeps the draft', async ({
    page,
    mailbox,
  }) => {
    const subject =
      'A rather long subject line for a phone, longer than one line of it can hold';
    await openPhoneComposer(page, mailbox);
    const folded = page.getByRole('button', {
      name: `Cc/Bcc, From: ${mailbox.inbox.email}`,
    });
    await expect(folded).toBeVisible();
    saw('STC-098');

    const to = phoneRecipientInput(page, 'To');
    for (const address of [
      'ann@example.com',
      'bob@example.com',
      'cy@example.com',
    ]) {
      await to.fill(address);
      await to.press('Enter');
    }
    // To takes the focus back once its suggestions have closed: the subject
    // waits for them to go, or it is typed into To.
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Subject' }).fill(subject);
    await phoneBody(page).tap();
    await expect(
      page.getByRole('button', {
        name: 'ann@example.com, bob@example.com & 1 more…',
      })
    ).toBeVisible();
    saw('STC-097');
    const foldedSubject = page.getByRole('button', { name: subject });
    await expect(foldedSubject).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Subject' })).toHaveCount(0);
    // One line, cut short: the text is wider than the row that shows it.
    const line = foldedSubject.locator('span');
    await expect(line).toHaveCSS('text-overflow', 'ellipsis');
    await expect(line).toHaveCSS('white-space', 'nowrap');
    expect(await line.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
      true
    );
    saw('STC-309');

    await folded.tap();
    const cc = page.getByText('Cc:', { exact: true });
    await expect(cc).toBeVisible();
    await expect(page.getByText('Bcc:', { exact: true })).toBeVisible();
    await expect(page.getByText('From:', { exact: true })).toBeVisible();
    await foldedSubject.tap();
    await expect(cc).toBeHidden();
    await expect(folded).toBeVisible();
    saw('STC-308');

    await phoneBody(page).tap();
    await page.keyboard.type('Kept for later.');
    await expect
      .poll(() => storedDraft(mailbox, subject), {
        message: 'the service never held the draft',
      })
      .toBeDefined();
    await page.getByRole('button', { name: 'Go Back' }).tap();
    const sheet = page.getByRole('dialog', { name: 'Draft options' });
    await expect(
      sheet.getByRole('button', { name: 'Delete Draft' })
    ).toBeVisible();
    await expect(
      sheet.getByRole('button', { name: 'Save Draft' })
    ).toBeVisible();
    saw('STC-091');

    await sheet.getByRole('button', { name: 'Save Draft' }).tap();
    await expect(sheet).toHaveCount(0);
    await openTouchTab(page, 'Drafts');
    await page
      .getByRole('grid', { name: 'Email' })
      .getByRole('row')
      .filter({ hasText: subject })
      .tap();
    await expect(phoneBody(page)).toContainText('Kept for later.');
    saw('STC-938');
  });
});

for (const provider of PROVIDERS) {
  test.describe(`the phone composer of ${anInbox(provider)} with a second inbox`, () => {
    test.use({ ...phone, provider });

    // When this fails, choosing the other inbox in the phone's From leaves
    // the old address shown, so the user cannot tell which inbox will send.
    // Which inboxes can send is the provider's data.
    test('From shows the inbox chosen there, also once the row folds', async ({
      page,
      mailbox,
    }) => {
      await mailbox.stack.link(mailbox.user, provider, WORK);
      await openPhoneComposer(page, mailbox);
      await page
        .getByRole('button', { name: `Cc/Bcc, From: ${mailbox.inbox.email}` })
        .tap();
      const from = page.getByRole('button', { name: 'From address' });
      await from.tap();
      await page.getByRole('menuitem').filter({ hasText: WORK }).tap();
      // The menu's own row for it can still be closing: the From is asked.
      await expect(from).toContainText(`${WORK} <${WORK}>`);
      saw('STC-960');
      await page.getByRole('textbox', { name: 'Subject' }).tap();
      await expect(
        page.getByRole('button', { name: `Cc/Bcc, From: ${WORK}` })
      ).toBeVisible();
    });
  });
}

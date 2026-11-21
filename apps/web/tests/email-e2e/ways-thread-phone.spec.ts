// A thread on a phone: the dock's arrows to the previous and next email and
// its check for done and not done, the saved reply's "Draft" row, and the
// header's subject (the thread's menu) and Info (its details). For a Gmail
// and an Outlook inbox.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import { hasDraft } from './harness/ways-compose2';
import { deliverEach, held, phone } from './harness/ways-thread';
import { openedOnPhone, phoneHeaderSubject } from './harness/ways-thread-more';
import { did } from './ledger/record';

for (const provider of PROVIDERS) {
  test.describe(`a thread on a phone, ${anInbox(provider)}`, () => {
    test.use({ ...phone, provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, the dock's arrows do not open the email after or
    // before the open one, its check does not mark the thread done (or not
    // done again) at the provider, or the "Draft" row under a message does
    // not reopen the saved reply.
    test('the dock moves between emails and marks done and not done, and the Draft row reopens a saved reply', async ({
      page,
      mailbox,
    }) => {
      const subjects = ['Alpha', 'Beta', 'Gamma'];
      const ids = await deliverEach(mailbox, subjects);
      const subjectOf = (id: string) =>
        subjects.find((subject) => ids[subject] === id) ?? '';
      await mailbox.open();
      expect(await page.evaluate(() => window.innerWidth)).toBe(
        phone.viewport.width
      );
      const list = page.getByRole('grid', { name: 'Email' });
      await expect.poll(async () => (await rowIds(page)).length).toBe(3);
      const [, middle, last] = await rowIds(page);
      const dock = page.locator('[data-mobile-dock-island]');

      await list.getByText(subjectOf(middle), { exact: true }).tap();
      await expect(page).toHaveURL(openedOnPhone(middle));
      await expect(
        page.getByText(`About ${subjectOf(middle)}.`).first()
      ).toBeVisible();

      // The arrows and the check first: a saved reply moves its thread in
      // the list, and opens its composer again when the thread is loaded.
      await dock.getByRole('button', { name: 'Next email' }).tap();
      did('AL-173');
      await expect(page).toHaveURL(openedOnPhone(last));
      await expect(
        page.getByText(`About ${subjectOf(last)}.`).first()
      ).toBeVisible();
      await dock.getByRole('button', { name: 'Previous email' }).tap();
      did('AL-173');
      await expect(page).toHaveURL(openedOnPhone(middle));
      await expect(
        page.getByText(`About ${subjectOf(middle)}.`).first()
      ).toBeVisible();

      // The check marks the open thread done and opens the next one.
      await dock.getByRole('button', { name: 'Mark done' }).tap();
      did('AL-174', 'F-071');
      await expect
        .poll(async () => (await held(mailbox, subjectOf(middle)))?.inInbox)
        .toBe(false);
      await expect(page).toHaveURL(
        new RegExp(`/app/email/(?!${middle})[0-9a-f-]{36}$`)
      );

      // On a done thread the same check marks it not done.
      await mailbox.open(`/app/email/${middle}`);
      await expect(
        page.getByText(`About ${subjectOf(middle)}.`).first()
      ).toBeVisible();
      await dock.getByRole('button', { name: 'Mark as not done' }).tap();
      did('AL-174', 'F-072');
      await expect
        .poll(async () => (await held(mailbox, subjectOf(middle)))?.inInbox)
        .toBe(true);

      // A reply saved by leaving the composer shows as a row under the
      // message it answers.
      await dock.getByRole('button', { name: 'Reply', exact: true }).tap();
      const composer = page.getByRole('dialog', { name: 'Reply composer' });
      const editor = composer.getByRole('textbox', { name: /reference files/ });
      const sheet = page.getByRole('dialog', { name: 'Draft options' });
      await editor.tap();
      await editor.pressSequentially('Half a thought');
      await composer.getByRole('button', { name: 'Go Back' }).tap();
      await sheet.getByRole('button', { name: 'Save Draft' }).tap();
      await expect(composer).toHaveCount(0);
      // Once the service holds it, the composer opens from the saved copy.
      await expect.poll(() => hasDraft(mailbox, middle)).toBe(true);
      const draft = page.getByRole('button', { name: /^Draft/ });
      await expect(draft).toContainText('Half a thought');
      await draft.tap();
      did('AL-175');
      await expect(composer).toBeVisible();
      await expect(editor).toHaveText('Half a thought');
    });
  });
}

// The header's two controls open sheets over the thread Macro already holds:
// nothing about them depends on the mailbox. Gmail only.
test.describe('the header of a thread on a phone', () => {
  test.use({ ...phone, provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, tapping the subject in a phone's thread header opens
  // no menu of the thread's actions, or its Info button opens no details.
  test("the subject opens the thread's menu and Info its details", async ({
    page,
    mailbox,
  }) => {
    const ids = await deliverEach(mailbox, ['Agenda']);
    await mailbox.open(`/app/email/${ids.Agenda}`);
    await expect(page.getByText('About Agenda.').first()).toBeVisible();

    await phoneHeaderSubject(page, 'Agenda').tap();
    did('AL-515');
    const menu = page.getByRole('dialog', { name: 'File actions' });
    await expect(menu.getByText('Mark Done', { exact: true })).toBeVisible();
    await expect(menu.getByText('Block Sender', { exact: true })).toBeVisible();
    // The sheet is closed once it has slid all the way in: one closed in
    // the frame its slide starts stays on the page, closing for good
    // (handoff phone-sheet-closed-while-opening-stays).
    await expect(menu).toBeInViewport({ ratio: 1 });
    await expect(menu).not.toHaveAttribute('data-transitioning');
    await expect(menu).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    await page.getByRole('button', { name: 'Show details' }).tap();
    did('AL-516');
    const details = page.getByRole('dialog', { name: 'Item details' });
    await expect(details.getByText('Properties')).toBeVisible();
    await expect(details.getByText('Created', { exact: true })).toBeVisible();
  });
});

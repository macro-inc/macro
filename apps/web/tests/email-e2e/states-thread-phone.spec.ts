// A thread on a phone: its header (Back, the subject and Info, nothing
// else), the dock's Reply all and Forward only where they do something, its
// arrows at the ends of the list, no done check on a thread only sent, and a
// saved reply's "Draft" row.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import { emptyReplyAtGmail, sharedByBob } from './harness/states-thread';
import { sendAtProvider } from './harness/sync';
import { hasDraft } from './harness/ways-compose2';
import { FROM, phone } from './harness/ways-thread';
import { saw } from './ledger/record';

for (const provider of PROVIDERS) {
  test.describe(`a thread on a phone, ${anInbox(provider)}`, () => {
    test.use({ ...phone, provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, the phone's thread header shows more than Back, the
    // subject and Info; the dock offers Reply all on a message only its
    // sender would get (or not on one with someone in Cc); its arrows are
    // not disabled at the first and last email of the list; or a thread
    // only sent (always done, never in the inbox) still offers a done check.
    test('the header, and the dock at the ends of the list and on a thread only sent', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: FROM,
        cc: 'Bob <bob@example.com>',
        subject: 'Group',
        text: 'About Group.',
      });
      await mailbox.deliver({
        from: FROM,
        subject: 'Solo',
        text: 'About Solo.',
      });
      await sendAtProvider(mailbox, {
        to: 'hugo@example.com',
        subject: 'Sent note',
        text: 'About Sent note.',
      });
      const ids: Record<string, string> = {};
      for (const subject of ['Group', 'Solo', 'Sent note'])
        ids[subject] = (await mailbox.synced(subject)).id;
      const subjectOf = (id: string) =>
        Object.keys(ids).find((subject) => ids[subject] === id) ?? '';

      await mailbox.open();
      expect(await page.evaluate(() => window.innerWidth)).toBe(
        phone.viewport.width
      );
      await expect.poll(async () => (await rowIds(page)).length).toBe(2);
      const [first, last] = await rowIds(page);
      const dock = page.locator('[data-mobile-dock-island]');
      const previous = dock.getByRole('button', { name: 'Previous email' });
      const next = dock.getByRole('button', { name: 'Next email' });
      const replyAll = dock.getByRole('button', { name: 'Reply all' });
      const forward = dock.getByRole('button', { name: 'Forward' });
      const expectReplyAll = async (id: string) => {
        if (subjectOf(id) === 'Group') await expect(replyAll).toBeVisible();
        else await expect(replyAll).toHaveCount(0);
      };

      await page
        .getByRole('grid', { name: 'Email' })
        .getByText(subjectOf(first), { exact: true })
        .tap();
      await expect(
        page.getByText(`About ${subjectOf(first)}.`).first()
      ).toBeVisible();
      // The header's islands: Back, the subject, Info.
      const islands = page.locator('[data-header-island]:visible');
      await expect(islands).toHaveCount(3);
      await expect(islands.nth(0).getByRole('button')).toHaveAccessibleName(
        'Go Back'
      );
      await expect(islands.nth(1)).toHaveText(subjectOf(first));
      await expect(islands.nth(2).getByRole('button')).toHaveAccessibleName(
        'Show details'
      );
      saw('STL-521');
      await expect(previous).toBeDisabled();
      await expect(next).toBeEnabled();
      await expectReplyAll(first);
      await expect(forward).toBeVisible();

      await next.tap();
      await expect(
        page.getByText(`About ${subjectOf(last)}.`).first()
      ).toBeVisible();
      await expect(next).toBeDisabled();
      await expect(previous).toBeEnabled();
      saw('STL-511', 'F-061');
      await expectReplyAll(last);
      saw('STL-107', 'F-109');

      await mailbox.open(`/app/email/${ids['Sent note']}`);
      await expect(page.getByText('About Sent note.').first()).toBeVisible();
      await expect(
        dock.getByRole('button', { name: 'Reply', exact: true })
      ).toBeVisible();
      await expect(dock.getByRole('button', { name: 'Mark done' })).toHaveCount(
        0
      );
      await expect(
        dock.getByRole('button', { name: 'Mark as not done' })
      ).toHaveCount(0);
      saw('STL-511', 'F-072');

      // A reply saved by leaving its composer shows under the message.
      await dock.getByRole('button', { name: 'Reply', exact: true }).tap();
      const composer = page.getByRole('dialog', { name: 'Reply composer' });
      const editor = composer.getByRole('textbox', { name: /reference files/ });
      const sheet = page.getByRole('dialog', { name: 'Draft options' });
      await editor.tap();
      await editor.pressSequentially('Half a thought');
      await composer.getByRole('button', { name: 'Go Back' }).tap();
      await sheet.getByRole('button', { name: 'Save Draft' }).tap();
      await expect(composer).toHaveCount(0);
      await expect.poll(() => hasDraft(mailbox, ids['Sent note'])).toBe(true);
      const draft = page.getByRole('button', { name: /^Draft/ });
      await expect(draft).toContainText('Half a thought');
      saw('STL-071');
    });
  });
}

// Who may forward a thread is Macro's own sharing, and the Draft row's
// words for a reply with no text are the row's own: both are the same
// whichever mailbox holds the thread. Gmail only (a reply with no text cannot
// be saved from Macro: leaving its composer empty discards it, so it is
// started in Gmail's own client, which quotes the message under it).
test.describe('a shared thread and an empty reply, on a phone', () => {
  test.use({ ...phone, provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, the dock of a thread shared with the viewer offers
  // Forward, which only the inbox holding its attachments can do; or a
  // saved reply with no text shows no "Draft" row saying so.
  test('the dock offers no Forward, and the Draft row says No text yet', async ({
    page,
    mailbox,
  }) => {
    const budget = await sharedByBob(mailbox, 'Budget');
    const empty = await emptyReplyAtGmail(mailbox, 'Ferry times');
    const dock = page.locator('[data-mobile-dock-island]');
    await mailbox.open(`/app/email/${budget}`);
    await expect(page.getByText('About Budget.').first()).toBeVisible();
    await expect(
      dock.getByRole('button', { name: 'Reply', exact: true })
    ).toBeVisible();
    await expect(dock.getByRole('button', { name: 'Forward' })).toHaveCount(0);
    saw('STL-107', 'F-110');

    // A thread with a saved reply opens it on a phone; leaving it saved
    // shows the reply's row.
    await mailbox.open(`/app/email/${empty}`);
    const composer = page.getByRole('dialog', { name: 'Reply composer' });
    await expect(composer).toBeVisible();
    await composer.getByRole('button', { name: 'Go Back' }).tap();
    await page
      .getByRole('dialog', { name: 'Draft options' })
      .getByRole('button', { name: 'Save Draft' })
      .tap();
    await expect(composer).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Draft/ })).toContainText(
      'No text yet'
    );
    saw('STL-071');
  });
});

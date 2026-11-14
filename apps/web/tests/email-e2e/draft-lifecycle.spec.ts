// A draft from its first save to its end, as the user sees it and as the
// email service holds it: listed in Drafts, back after a reload, gone once
// discarded; and a reply draft that stays with its thread. The same on a
// Gmail and an Outlook inbox.

import {
  composeNew,
  discardButton,
  draftThreads,
  loadAppSteadily,
  routeDraftId,
} from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { replyEditor } from './harness/send';
import type { Provider } from './harness/stack';
import { messageCard, threadMessages } from './harness/thread';
import { confirmed, did, saw } from './ledger/record';

const PROVIDERS: Provider[] = ['GMAIL', 'OUTLOOK'];

for (const provider of PROVIDERS) {
  test.describe(`a draft in ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, what was typed is not saved by itself, the saved
    // draft is missing from Drafts, a reload loses it, or the trash leaves
    // it behind.
    test('a new message is saved while typing, listed in Drafts, back after a reload, and gone once discarded', async ({
      page,
      mailbox,
    }) => {
      await composeNew(page, mailbox, {
        to: 'grace@example.com',
        subject: 'Offsite plan',
        body: 'Thinking of the coast.',
      });
      await routeDraftId(page);
      await expect
        .poll(async () =>
          (await draftThreads(mailbox)).map((thread) => thread.name)
        )
        .toEqual(['Offsite plan']);
      confirmed('F-115');

      // Drafts lists it, and its row opens it with its text.
      const tabs = page.getByRole('navigation', { name: 'Email tabs' });
      await tabs.getByRole('button', { name: 'Drafts' }).click();
      const row = page
        .getByRole('grid', { name: 'Email' })
        .getByRole('row')
        .filter({ hasText: 'Offsite plan' });
      await expect(row).toHaveCount(1);
      await row.click();
      await expect(page.getByPlaceholder(/subject/i)).toHaveValue(
        'Offsite plan'
      );
      await expect(page.getByText('Thinking of the coast.')).toBeVisible();
      saw('STC-938');

      await page.reload();
      did('AC-912');
      await expect(page.getByPlaceholder(/subject/i)).toHaveValue(
        'Offsite plan'
      );
      await expect(
        page.getByRole('link', { name: 'grace@example.com' })
      ).toBeVisible();
      await expect(page.getByText('Thinking of the coast.')).toBeVisible();
      saw('STC-961');

      await discardButton(page).click();
      did('AC-060');
      await expect(page.getByPlaceholder(/subject/i)).toHaveCount(0);
      await expect(
        page.getByRole('heading', { name: 'No drafts' })
      ).toBeVisible();
      await expect(page.getByText('Offsite plan')).toHaveCount(0);
      saw('STL-969');
      await expect.poll(() => draftThreads(mailbox)).toEqual([]);
      confirmed('F-119');
    });

    // When this fails, leaving a reply with Escape throws it away, or the
    // reply is not kept as the draft of the message it answers.
    test('a reply left with Escape stays with its thread and reopens there', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Lunch?',
        text: 'Noon at the usual place?',
      });
      const thread = await mailbox.synced('Lunch?');
      const drafts = async () =>
        (await threadMessages(mailbox, thread.id)).filter(
          (message) => message.is_draft
        );

      await mailbox.open(`/app/mail/${thread.id}`);
      did('AL-910');
      await page.getByText('Reply...').click();
      did('AL-171');
      await replyEditor(page).pressSequentially('Works for me.');
      did('AC-081');
      await expect.poll(async () => (await drafts()).length).toBe(1);

      // The first Escape leaves the editor, the second leaves the reply.
      await page.keyboard.press('Escape');
      await expect(replyEditor(page)).not.toBeFocused();
      await page.keyboard.press('Escape');
      did('AC-094', 'F-117');
      await expect(messageCard(page, 'Noon at the usual place?')).toBeFocused();

      await page.reload();
      await expect(replyEditor(page)).toHaveText('Works for me.');
      await expect(
        page.getByRole('button', { name: 'Replying to Grace' })
      ).toBeVisible();
      saw('STL-962');

      // The service holds one draft, of the message it answers, with the text.
      await expect(async () => {
        const [original] = (await threadMessages(mailbox, thread.id)).filter(
          (message) => !message.is_draft
        );
        const [draft, ...others] = await drafts();
        expect(others).toEqual([]);
        expect(draft.replying_to_id).toBe(original.db_id);
        expect(JSON.stringify(draft)).toContain('Works for me.');
      }).toPass({ timeout: 30_000 });
      confirmed('F-117');
    });
  });
}

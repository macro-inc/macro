// Email reached from outside the mail view: the universal input, the task
// composer a thread opens, and a thread's link pasted into another editor.

import type { Page } from '@playwright/test';
import { draftThreads } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { readMailbox } from './harness/journeys';
import { anInbox, PROVIDERS } from './harness/providers';
import { confirmed, did, saw } from './ledger/record';

const from = 'Grace <grace@example.com>';
const recipient = 'bob@example.com';
// The universal input only offers its fields for a text this long.
const request = 'Tell Bob that lunch on Friday moved to one, same place.';

/** Opens the universal input on a typed request and chooses Email. */
async function universalEmail(page: Page, subject: string): Promise<void> {
  await expect(page.getByText('Inbox').first()).toBeVisible();
  const input = page.getByRole('region', {
    name: 'Create or find something',
  });
  // The shortcut is bound once the app has loaded, a moment after it paints.
  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await page.keyboard.type(request);
  await page.getByRole('button', { name: 'Content type' }).click();
  await page.getByRole('option', { name: 'Email' }).click();
  did('AX-305');
  await expect(input.getByText('Choose a recipient')).toBeVisible();
  saw('STX-033');
  const to = input.getByRole('combobox', { name: 'To' });
  await to.fill(recipient);
  await to.press('Enter');
  await input.getByRole('textbox', { name: 'Subject' }).fill(subject);
  await expect(
    input.getByRole('textbox', { name: 'Outgoing message' })
  ).toContainText(request);
  did('AX-306');
}

for (const provider of PROVIDERS) {
  test.describe(`elsewhere in Macro, with ${anInbox(provider)}`, () => {
    test.use({ provider });

    // Class universal-input-email-needs-draft-id: the universal input saves
    // its email without a draft id, which the save refuses ("Save the draft
    // before sending"), so nothing is saved or sent.
    // When this fails, an email written in the universal input is not sent:
    // "Send email" does nothing, never says "Email sent", or the provider
    // gets no message, or one with another recipient, subject or text.
    test('known bug: universal-input-email-needs-draft-id: the universal input sends an email @known-bug', {
      tag: '@known-bug',
    }, async ({ page, mailbox }) => {
      await mailbox.open('/app/mail');
      await universalEmail(page, 'Lunch moved');

      await page.getByRole('button', { name: 'Send email' }).click();
      did('AX-050');
      await expect(
        page.getByRole('status').filter({ hasText: 'Email sent' })
      ).toBeVisible();
      saw('STX-303');

      await expect
        .poll(
          async () =>
            (await readMailbox(mailbox, mailbox.inbox.email))
              .filter((message) => message.subject === 'Lunch moved')
              .map((message) => ({
                to: message.to,
                text: message.html.includes(request),
              })),
          { timeout: 40_000 }
        )
        .toEqual([{ to: [recipient], text: true }]);
      confirmed('F-166');
    });

    // Class universal-input-email-needs-draft-id, as above.
    // When this fails, "Save as draft" in the universal input keeps no
    // draft, or its "Open" leads somewhere else than the draft it saved.
    test('known bug: universal-input-email-needs-draft-id: the universal input saves an email draft and opens it @known-bug', {
      tag: '@known-bug',
    }, async ({ page, mailbox }) => {
      await mailbox.open('/app/mail');
      await universalEmail(page, 'Lunch moved');

      await page.getByRole('button', { name: 'Save as draft' }).click();
      did('AX-049');
      const result = page
        .getByRole('status')
        .filter({ hasText: 'Email draft saved' });
      await expect(result).toBeVisible();
      saw('STX-303');
      await expect
        .poll(async () =>
          (await draftThreads(mailbox)).map((thread) => thread.name)
        )
        .toEqual(['Lunch moved']);

      await result.getByRole('button', { name: 'Open' }).click();
      did('AX-307');
      await expect(page.getByPlaceholder(/subject/i)).toHaveValue(
        'Lunch moved'
      );
      await expect(page.getByText(request)).toBeVisible();
    });

    // When this fails, "Create task" on a thread opens no task composer, or
    // one that does not carry the thread: the task would not lead back to it.
    test('Create task on a thread opens a task that carries the thread', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Lunch?', text: 'Noon?' });
      const thread = await mailbox.synced('Lunch?');
      await mailbox.open(`/app/mail/${thread.id}`);
      await expect(page.getByText('Noon?')).toBeVisible();

      await page.getByRole('button', { name: 'Create task' }).click();
      did('AL-130');
      const composer = page.getByRole('dialog');
      await expect(
        composer.getByRole('textbox', { name: 'Title' })
      ).toBeVisible();
      await expect(
        composer.getByRole('button', { name: 'Open source Lunch?' })
      ).toBeVisible();
      saw('STL-945');
    });

    // When this fails, a thread's link pasted into another editor stays a
    // bare address, or becomes a chip that does not name the thread.
    test("a thread's link pasted into a task description becomes a mention of it", async ({
      page,
      mailbox,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await mailbox.deliver({ from, subject: 'Lunch?', text: 'Noon?' });
      await mailbox.deliver({ from, subject: 'Agenda', text: 'Two items.' });
      const lunch = await mailbox.synced('Lunch?');
      const agenda = await mailbox.synced('Agenda');

      await mailbox.open();
      await page.locator(`[data-entity-id="${agenda.id}"]`).click({
        button: 'right',
      });
      await page
        .getByRole('menu')
        .getByRole('menuitem', { name: /^Copy Link/ })
        .click();
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe(`${mailbox.front.origin}/app/mail/${agenda.id}`);

      await mailbox.open(`/app/mail/${lunch.id}`);
      await expect(page.getByText('Noon?')).toBeVisible();
      await page.getByRole('button', { name: 'Create task' }).click();
      const composer = page.getByRole('dialog');
      const description = composer.locator('[contenteditable="true"]').last();
      await description.click();
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.press('ControlOrMeta+v');
      did('AX-319');
      await expect(
        description.getByRole('link', { name: 'Agenda' })
      ).toBeVisible();
      await expect(description).not.toContainText('/app/mail/');
      saw('STX-949');
    });
  });
}

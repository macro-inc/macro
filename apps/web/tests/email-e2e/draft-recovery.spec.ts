// A draft the user comes back to, and a draft in trouble: reopened from
// Drafts and edited further, refused by the server and saved on Retry, and
// kept on the device when the user backs out of signing out. The same on a
// Gmail and an Outlook inbox.

import {
  body,
  composeNew,
  draftThreads,
  graphqlOperation,
  loadAppSteadily,
  routeDraftId,
} from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { threadMessages } from './harness/send';
import type { Provider } from './harness/stack';
import { confirmed, did, saw } from './ledger/record';

const PROVIDERS: Provider[] = ['GMAIL', 'OUTLOOK'];

for (const provider of PROVIDERS) {
  test.describe(`a draft to come back to in ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a draft's row in Drafts does not open it, the composer
    // opens without what was written, or what is typed after reopening goes
    // to a second draft or is not saved at all.
    test('a draft reopened from Drafts shows what was written and keeps what is typed next', async ({
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

      // Away from the composer, then back to the draft through Drafts.
      await mailbox.open('/app/mail');
      await page
        .getByRole('navigation', { name: 'Email tabs' })
        .getByRole('button', { name: 'Drafts' })
        .click();
      await page
        .getByRole('grid', { name: 'Email' })
        .getByRole('row')
        .filter({ hasText: 'Offsite plan' })
        .click();
      did('AC-913');
      await expect(page.getByPlaceholder(/subject/i)).toHaveValue(
        'Offsite plan'
      );
      await expect(
        page.getByRole('link', { name: 'grace@example.com' })
      ).toBeVisible();
      await expect(body(page)).toHaveText('Thinking of the coast.');

      await body(page).click();
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.type(' Or the hills.');
      await expect(body(page)).toHaveText(
        'Thinking of the coast. Or the hills.'
      );
      saw('STC-974');

      // The service holds one draft, the same one, with the later text.
      await expect(async () => {
        const drafts = await draftThreads(mailbox);
        expect(drafts.map((thread) => thread.name)).toEqual(['Offsite plan']);
        const messages = await threadMessages(mailbox, drafts[0].id);
        expect(messages.map((message) => message.is_draft)).toEqual([true]);
        expect(String(messages[0].body_html_sanitized)).toContain(
          'Thinking of the coast. Or the hills.'
        );
      }).toPass({ timeout: 30_000 });
      confirmed('F-116');
    });

    // When this fails, a draft the server refused to save is not reported
    // (the user leaves believing it is saved), or Retry does not save it once
    // the server accepts it again.
    test('a draft the server refuses is reported in the composer and saved by Retry', async ({
      page,
      mailbox,
    }) => {
      let refusing = true;
      await page.route(/\/graphql$/, async (route) => {
        if (!refusing || graphqlOperation(route.request()) !== 'SaveEmailDraft')
          return route.fallback();
        await route.fulfill({
          json: {
            data: null,
            errors: [
              {
                message: 'invalid',
                path: ['saveEmailDraft'],
                extensions: { code: 'INVALID' },
              },
            ],
          },
        });
      });
      await composeNew(page, mailbox, {
        to: 'grace@example.com',
        subject: 'Offsite plan',
        body: 'Thinking of the coast.',
      });

      const banner = page
        .getByRole('alert')
        .filter({ hasText: 'Draft could not be synced' });
      await expect(banner).toContainText(
        'The server could not save this draft.'
      );
      saw('STC-082');
      expect(await draftThreads(mailbox)).toEqual([]);

      refusing = false;
      await banner.getByRole('button', { name: 'Retry', exact: true }).click();
      did('AC-064');
      await expect(banner).toHaveCount(0);
      await expect(body(page)).toHaveText('Thinking of the coast.');
      // What Retry saved is the draft as written.
      await expect(async () => {
        const drafts = await draftThreads(mailbox);
        expect(drafts.map((thread) => thread.name)).toEqual(['Offsite plan']);
        const [draft] = await threadMessages(mailbox, drafts[0].id);
        expect(String(draft.body_html_sanitized)).toContain(
          'Thinking of the coast.'
        );
      }).toPass({ timeout: 30_000 });
    });

    // When this fails, signing out with a draft that only this device holds
    // does not ask first, or backing out of the question signs the user out
    // or loses the text that was never saved to the server.
    test('backing out of signing out keeps the text only this device holds', async ({
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

      // From here on no save reaches the server: what is typed stays local.
      let dropped = 0;
      await page.route(/\/graphql$/, async (route) => {
        if (graphqlOperation(route.request()) !== 'SaveEmailDraft')
          return route.fallback();
        dropped += 1;
        await route.abort();
      });
      await body(page).click();
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.type(' Only on this device.');
      await expect.poll(() => dropped).toBeGreaterThan(0);

      await mailbox.open('/app/mail/~/settings/account');
      await page.getByRole('button', { name: 'Log out', exact: true }).click();
      const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
      await expect(
        dialog.getByText('Sign out and remove local drafts?')
      ).toBeVisible();
      await expect(
        dialog.getByText(
          '1 draft(s) have changes saved only on this device. Signing out removes those changes and their pending attachments.'
        )
      ).toBeVisible();
      saw('STC-109');
      saw('STX-031');
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      did('AC-401');
      did('AX-216');
      await expect(dialog).toHaveCount(0);

      // Still signed in, and the draft still has the text the server never got.
      await mailbox.open('/app/mail');
      await page
        .getByRole('navigation', { name: 'Email tabs' })
        .getByRole('button', { name: 'Drafts' })
        .click();
      await page
        .getByRole('grid', { name: 'Email' })
        .getByRole('row')
        .filter({ hasText: 'Offsite plan' })
        .click();
      await expect(body(page)).toHaveText(
        'Thinking of the coast. Only on this device.'
      );
      const [thread] = await draftThreads(mailbox);
      const [saved] = await threadMessages(mailbox, thread.id);
      expect(String(saved.body_html_sanitized)).toContain(
        'Thinking of the coast.'
      );
      expect(String(saved.body_html_sanitized)).not.toContain(
        'Only on this device.'
      );
    });
  });
}

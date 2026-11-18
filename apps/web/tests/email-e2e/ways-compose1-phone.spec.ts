// The phone's own ways into a new message: the full-screen composer's
// folded rows, its header's Attach and Send, and the sheet that asks what to
// do with a draft on the way out. Each for a Gmail and an Outlook inbox.

import type { Page } from '@playwright/test';
import { loadAppSteadily, relayUploads } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { addMailbox, readMailbox } from './harness/journeys';
import { phoneRecipientInput } from './harness/ways-compose-more';
import {
  named,
  openPhoneComposer,
  PROVIDERS,
  phone,
  phoneBody,
  sentCopy,
  storedDraft,
} from './harness/ways-compose1';
import { did } from './ledger/record';

/** A new message to `to` with a subject and a line of body, the body focused. */
async function start(page: Page, to: string, subject: string) {
  const field = page.getByRole('combobox').first();
  await field.fill(to);
  await field.press('Enter');
  await page.getByRole('textbox', { name: 'Subject' }).fill(subject);
  await phoneBody(page).tap();
  await page.keyboard.type('Bring a blanket.');
}

for (const provider of PROVIDERS) {
  test.describe(`the phone's composer, ${named(provider)} inbox`, () => {
    test.use({ ...phone, provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a folded row of the phone's composer no longer opens
    // (the subject, Cc/Bcc), or the header's Attach or Send does nothing:
    // the message cannot be finished, or goes out without the subject, the
    // people or the file added there.
    test('the folded subject and Cc/Bcc rows open again and the header attaches and sends', async ({
      page,
      mailbox,
    }) => {
      const grace = await addMailbox(mailbox, 'grace@example.com');
      const ida = await addMailbox(mailbox, 'ida@example.com');
      await relayUploads(page);
      await openPhoneComposer(page, mailbox);
      expect(await page.evaluate(() => window.innerWidth)).toBe(
        phone.viewport.width
      );
      await start(page, grace, 'Picnic');

      // With the body focused, the subject folds to one line.
      await page.getByRole('button', { name: 'Picnic', exact: true }).tap();
      did('AC-314');
      const subject = page.getByRole('textbox', { name: 'Subject' });
      await expect(subject).toBeFocused();
      await subject.fill('Picnic on Sunday');

      // Cc, Bcc and From fold into one row until it is tapped.
      const cc = phoneRecipientInput(page, 'Cc');
      await expect(cc).toHaveCount(0);
      await page.getByRole('button', { name: /^Cc\/Bcc, From:/ }).tap();
      did('AC-013', 'F-099');
      await expect(phoneRecipientInput(page, 'Bcc')).toBeVisible();
      await expect(page.getByText('From:', { exact: true })).toBeVisible();
      await cc.fill(ida);
      await cc.press('Enter');
      await expect(page.getByRole('link', { name: ida })).toBeVisible();

      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Attach' }).tap();
      did('AC-025');
      await (await chooser).setFiles({
        name: 'map.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('North gate.'),
      });
      await expect(page.getByText('map.txt')).toBeVisible();

      await page.getByRole('button', { name: 'Send email' }).tap();
      did('AC-058');

      const sent = await sentCopy(mailbox, 'Picnic on Sunday');
      expect(sent.to).toEqual([grace]);
      expect(sent.cc).toEqual([ida]);
      expect(sent.html).toContain('Bring a blanket.');
      expect(sent.attachments).toEqual(['map.txt']);
      await expect
        .poll(async () =>
          (await readMailbox(mailbox, ida)).map((message) => message.subject)
        )
        .toEqual(['Picnic on Sunday']);
    });

    // A tap on the folded To summary returns focus to the recipient input
    // so another address can be added to the message.
    test('tapping the folded recipients opens To again', async ({
      page,
      mailbox,
    }) => {
      const grace = await addMailbox(mailbox, 'grace@example.com');
      const zed = await addMailbox(mailbox, 'zed@example.com');
      await openPhoneComposer(page, mailbox);
      await start(page, grace, 'Rug');

      const to = phoneRecipientInput(page, 'To');
      await page.getByRole('button', { name: grace, exact: true }).tap();
      did('AC-014');
      await expect(to).toBeFocused({ timeout: 5_000 });
      await to.fill(zed);
      await to.press('Enter');
      await page.getByRole('button', { name: 'Send email' }).tap();
      const sent = await sentCopy(mailbox, 'Rug');
      expect([...sent.to].sort()).toEqual([grace, zed].sort());
    });

    // When this fails, leaving the phone's composer goes wrong: an untouched
    // one asks about a draft that does not exist, a tap beside the sheet no
    // longer closes it to keep writing, Save Draft loses the draft, or
    // Delete Draft leaves it behind.
    test('Back leaves an untouched composer at once, and the sheet keeps, closes or deletes a draft', async ({
      page,
      mailbox,
    }) => {
      const list = page.getByRole('grid', { name: 'Email' });
      const sheet = page.getByRole('dialog', { name: 'Draft options' });
      const back = page.getByRole('button', { name: 'Go Back' });
      const send = page.getByRole('button', { name: 'Send email' });
      const write = async (subject: string) => {
        await openPhoneComposer(page, mailbox);
        await start(page, 'grace@example.com', subject);
        await expect
          .poll(() => storedDraft(mailbox, subject), { timeout: 30_000 })
          .toBeDefined();
      };

      await openPhoneComposer(page, mailbox);
      await back.tap();
      did('AC-316');
      await expect(send).toHaveCount(0);
      await expect(sheet).toHaveCount(0);
      await expect(list).toBeVisible();

      await write('Kept draft');
      await back.tap();
      await expect(sheet).toBeVisible();
      // Once it has slid in: a person cannot tap beside a sheet still moving.
      await expect(sheet).not.toHaveAttribute('data-transitioning');
      // Above the sheet, on the dimmed composer.
      const top = await sheet.boundingBox();
      expect(top?.y).toBeGreaterThan(200);
      await page.touchscreen.tap(phone.viewport.width / 2, 100);
      did('AC-315');
      await expect(sheet).toHaveCount(0);
      await expect(send).toBeVisible();
      await expect(phoneBody(page)).toHaveText('Bring a blanket.');

      await back.tap();
      await sheet.getByRole('button', { name: 'Save Draft' }).tap();
      did('AC-061');
      await expect(send).toHaveCount(0);
      await expect(list).toBeVisible();
      expect(await storedDraft(mailbox, 'Kept draft')).toBeDefined();

      await write('Dropped draft');
      await back.tap();
      await sheet.getByRole('button', { name: 'Delete Draft' }).tap();
      did('AC-062');
      await expect(sheet).toHaveCount(0);
      await expect
        .poll(() => storedDraft(mailbox, 'Dropped draft'), { timeout: 30_000 })
        .toBeUndefined();
      // The other draft is still there.
      expect(await storedDraft(mailbox, 'Kept draft')).toBeDefined();
    });

    // When this fails, Escape no longer closes the Draft options sheet to
    // go on writing (a phone with a keyboard). Today the sheet starts to
    // close and opens again (handoff phone-draft-sheet-escape-reopens).
    // `@sometimes`: the sheet stays closed in some runs, and one pass does
    // not say the bug is gone.
    test('known bug: phone-draft-sheet-escape-reopens: Escape closes the Draft options sheet and keeps the composer @known-bug', {
      tag: ['@known-bug', '@sometimes'],
    }, async ({ page, mailbox }) => {
      const sheet = page.getByRole('dialog', { name: 'Draft options' });
      await openPhoneComposer(page, mailbox);
      await start(page, 'grace@example.com', 'Escaped draft');
      await expect
        .poll(() => storedDraft(mailbox, 'Escaped draft'), { timeout: 30_000 })
        .toBeDefined();
      await page.getByRole('button', { name: 'Go Back' }).tap();
      await expect(sheet).toBeVisible();
      await expect(sheet).not.toHaveAttribute('data-transitioning');
      await page.keyboard.press('Escape');
      did('AC-315');
      await expect(sheet).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Send email' })
      ).toBeVisible();
      await expect(phoneBody(page)).toHaveText('Bring a blanket.');
    });
  });
}

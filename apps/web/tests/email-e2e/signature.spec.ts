// The signature of an inbox in Settings › Email beyond writing one: clearing
// it, choosing whether replies and forwards get it, and asking Gmail for the
// one kept there.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { PROVIDERS } from './harness/providers';
import { injectFault, notice } from './harness/send';
import { confirmed, did, saw } from './ledger/record';

const SETTINGS = '/app/mail/~/settings/email';
const SIGNATURE = '<p><b>Ada</b> at Analytical Engines</p>';
const REPLIES = 'Add to replies & forwards';

type SignatureSettings = {
  signature?: string | null;
  signature_on_replies_forwards?: boolean | null;
};

/** What the email service holds as the settings of the test's inbox. */
async function storedSettings(mailbox: Mailbox): Promise<SignatureSettings> {
  const response = await mailbox.api('/email/email/links');
  const { links } = (await response.json()) as {
    links: { email_address: string; settings?: SignatureSettings }[];
  };
  const own = links.find((link) => link.email_address === mailbox.inbox.email);
  return own?.settings ?? {};
}

/** Writes a signature in Settings and saves it. */
async function writeSignature(page: Page, mailbox: Mailbox): Promise<void> {
  const own = mailbox.inbox.email;
  await page
    .getByRole('tablist', { name: `Signature views for ${own}` })
    .getByRole('tab', { name: 'HTML' })
    .click();
  did('AX-020');
  const save = page.getByRole('button', { name: 'Save signature' });
  // Save can stay disabled when the text is typed as the editor mounts (seen
  // under load), so it is typed until Save takes it.
  await expect(async () => {
    await page
      .getByRole('textbox', { name: `Signature HTML for ${own}` })
      .fill(SIGNATURE);
    await expect(save).toBeEnabled({ timeout: 2_000 });
  }).toPass();
  did('AX-021');
  await save.click();
  did('AX-024');
  await expect(notice(page, 'Signature saved')).toBeVisible();
  saw('STX-015', 'F-148');
  await expect
    .poll(async () => (await storedSettings(mailbox)).signature)
    .toContain('Ada');
}

test.beforeEach(({ page }) => loadAppSteadily(page));

for (const provider of PROVIDERS) {
  const inbox = provider === 'GMAIL' ? 'a Gmail' : 'an Outlook';

  test.describe(`the signature of ${inbox} inbox`, () => {
    test.use({ provider });

    test('clearing the signature removes it from the inbox', async ({
      page,
      mailbox,
    }) => {
      await mailbox.open(SETTINGS);
      const clear = page.getByRole('button', { name: 'Clear signature' });
      await expect(clear).toBeDisabled();
      await writeSignature(page, mailbox);

      await clear.click();
      did('AX-025');
      await expect(notice(page, 'Signature removed')).toBeVisible();
      saw('STX-015', 'F-150');
      await expect(clear).toBeDisabled();
      await expect
        .poll(async () => (await storedSettings(mailbox)).signature ?? '')
        .toBe('');
      confirmed('F-150');
    });

    test('the switch decides whether replies and forwards get the signature', async ({
      page,
      mailbox,
    }) => {
      await mailbox.open(SETTINGS);
      await writeSignature(page, mailbox);
      const replies = page.getByRole('switch', { name: REPLIES });
      await expect(replies).not.toBeChecked();
      expect(
        (await storedSettings(mailbox)).signature_on_replies_forwards ?? false
      ).toBe(false);

      // The switch's input is hidden under its track: the click goes there.
      await replies.locator('xpath=following-sibling::div[1]').click();
      did('AX-027');
      await expect(replies).toBeChecked();
      saw('STX-966');
      await expect
        .poll(
          async () =>
            (await storedSettings(mailbox)).signature_on_replies_forwards
        )
        .toBe(true);
      confirmed('F-152');

      await replies.locator('xpath=following-sibling::div[1]').click();
      did('AX-027');
      await expect(replies).not.toBeChecked();
      await expect
        .poll(
          async () =>
            (await storedSettings(mailbox)).signature_on_replies_forwards
        )
        .toBe(false);
    });
  });
}

test.describe('the signature Gmail keeps', () => {
  test.use({ provider: 'GMAIL' });

  // The Gmail emulator keeps no signature for the address of the inbox, so
  // an import that brings one over is not driven here: only its other ends.
  test('importing says when Gmail has no signature and when Gmail fails', async ({
    page,
    mailbox,
  }) => {
    await mailbox.open(SETTINGS);
    const importing = page.getByRole('button', { name: 'Import from Gmail' });
    await importing.click();
    did('AX-026');
    await expect(notice(page, 'No signature found in Gmail')).toBeVisible();
    saw('STX-016');
    expect((await storedSettings(mailbox)).signature ?? '').toBe('');

    await injectFault(mailbox, {
      route: 'settings.sendAs.list',
      error: 'forbidden',
    });
    await importing.click();
    did('AX-026');
    await expect(
      notice(page, 'Failed to import signature. Please try again.')
    ).toBeVisible();
    saw('STX-016');
  });
});

// What the signature editor in Settings › Email says while a save is on
// its way and when it fails, and what a phone shows in its place.

import { devices } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { holdRequests, settingsSection } from './harness/states-settings';
import { signatureTabs } from './harness/ways-settings';
import { openSettled } from './harness/ways-settings-more';
import { saw } from './ledger/record';

const { defaultBrowserType: _browser, ...phone } = devices['iPhone 13'];

test.beforeEach(({ page }) => loadAppSteadily(page));

// Saving a signature is the same request and the same messages whatever the
// inbox (the service checks a signature's pictures the same way for both),
// so this runs on Gmail only.
test.describe('saving the signature of a Gmail inbox', () => {
  // When this fails, Save signature can be pressed again while a save is on
  // its way, or a save that failed (or whose picture the service cannot
  // keep) leaves the signature unsaved without a word.
  test('Save signature says it is saving, then why a save failed', async ({
    page,
    mailbox,
  }) => {
    const own = mailbox.inbox.email;
    await openSettled(page, mailbox);
    await signatureTabs(page, own).getByRole('tab', { name: 'HTML' }).click();
    const html = page.getByRole('textbox', {
      name: `Signature HTML for ${own}`,
    });
    const save = page.getByRole('button', { name: 'Save signature' });
    // Save can stay disabled when the text is typed as the editor mounts
    // (`signature.spec.ts`), so it is typed until Save takes it.
    const write = async (signature: string) => {
      await expect(async () => {
        await html.fill(signature);
        await expect(save).toBeEnabled({ timeout: 2_000 });
      }).toPass();
    };
    const signatures = settingsSection(page, 'Signatures');

    const saving = await holdRequests(
      page,
      /\/email\/email\/settings(\?|$)/,
      'PATCH'
    );
    await write('<p><b>Ada</b> at Analytical Engines</p>');
    await save.click();
    const pending = page.getByRole('button', { name: 'Saving…' });
    await expect(pending).toBeDisabled();
    saw('STX-206');
    saving.fail();
    await expect(
      signatures.getByText('Failed to save signature. Please try again.')
    ).toBeVisible();
    saw('STX-206');
    await expect(save).toBeEnabled();

    // The service keeps a signature's pictures itself, and refuses to fetch
    // one from a loopback address.
    saving.release();
    await write(
      '<p>Ada</p><img src="http://127.0.0.1:9/logo.png" alt="Logo" width="40" height="40">'
    );
    await save.click();
    await expect(
      signatures.getByText(
        'Unable to save images. Add accessible image URLs in HTML, or use the image button in Rich text.'
      )
    ).toBeVisible();
    saw('STX-206');
    await expect(
      signatures.getByText('Failed to save signature. Please try again.')
    ).toBeHidden();
  });
});

// The phone's version of the editor is the same for every inbox; Gmail is
// the one that would offer Import, which the phone must leave out.
test.describe('the signature of a Gmail inbox on a phone', () => {
  test.use({ ...phone, provider: 'GMAIL' });

  // When this fails, a phone shows an empty box instead of saying no
  // signature is saved and where to write one, or offers editing (tabs,
  // Save, Import) it is not meant to.
  test('a phone shows the saved signature only and sends editing to the desktop', async ({
    page,
    mailbox,
  }) => {
    const own = mailbox.inbox.email;
    await openSettled(page, mailbox);
    const signatures = settingsSection(page, 'Signatures');
    await expect(signatures.getByText('No signature saved.')).toBeVisible();
    await expect(
      signatures.getByText('Update your signature on desktop.')
    ).toBeVisible();
    await expect(signatureTabs(page, own)).toHaveCount(0);
    await expect(
      signatures.getByRole('button', { name: 'Save signature' })
    ).toHaveCount(0);
    await expect(
      signatures.getByRole('button', { name: 'Import from Gmail' })
    ).toHaveCount(0);
    saw('STX-018');
  });
});

// What Mail offers to learn it by: the tutorial video row at the top of the
// inbox, the sheet of this view's keyboard shortcuts, and the shortcut
// reference in Settings. Each for a Gmail and an Outlook inbox.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { focusRow, rowIds } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import { did, saw } from './ledger/record';

for (const provider of PROVIDERS) {
  test.describe(`learning Mail in ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, the inbox has no tutorial row, the row does not open
    // its video, it shows outside the inbox's Signal tab, or a dismissed row
    // is back after a reload.
    test('the tutorial row opens its video, and stays away once dismissed', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Agenda',
        text: 'About Agenda.',
      });
      const agenda = await mailbox.synced('Agenda');
      const list = page.getByRole('grid', { name: 'Email' });
      const tutorial = list.getByRole('button', {
        name: /Learn how to use Macro Mail/,
      });
      const views = page.getByRole('radiogroup', { name: 'Inbox view' });
      const video = page.getByRole('dialog', {
        name: 'Learn how to use Macro Mail',
      });

      await mailbox.open();
      await expect.poll(() => rowIds(page)).toEqual([agenda.id]);
      await expect(tutorial).toBeVisible();
      // It introduces the inbox: the other views have none.
      await views.getByText('Noise', { exact: true }).click();
      await expect(views.getByRole('radio', { name: 'Noise' })).toBeChecked();
      await expect(tutorial).toHaveCount(0);
      await views.getByText('Signal', { exact: true }).click();
      await expect(tutorial).toBeVisible();
      saw('STL-023');

      await tutorial.click();
      did('AL-101');
      await expect(video).toBeVisible();
      await expect(
        video.getByRole('button', { name: /^Play Learn how to use Macro Mail/ })
      ).toBeVisible();
      saw('STL-974');
      await video.getByRole('button', { name: 'Close video' }).click();
      await expect(video).toHaveCount(0);
      await expect(tutorial).toBeVisible();

      await list.getByRole('button', { name: 'Dismiss' }).click();
      did('AL-102');
      await expect(tutorial).toHaveCount(0);
      await mailbox.open();
      await expect.poll(() => rowIds(page)).toEqual([agenda.id]);
      await expect(views.getByRole('radio', { name: 'Signal' })).toBeChecked();
      await expect(tutorial).toHaveCount(0);
      saw('STL-975');
    });

    // When this fails, ? opens no sheet in Mail, the sheet lacks the
    // shortcuts of the mail list, or Settings no longer documents the email
    // shortcuts.
    test("? opens the sheet of Mail's shortcuts, and Settings lists the email shortcuts", async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Agenda',
        text: 'About Agenda.',
      });
      const agenda = await mailbox.synced('Agenda');
      const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
      const here = sheet.getByRole('region', { name: 'This view' });

      await mailbox.open();
      await focusRow(page, agenda.id);
      await expect(sheet).toHaveCount(0);
      await page.keyboard.press('Shift+Slash');
      did('AL-103');
      await expect(sheet).toBeVisible();
      for (const shortcut of [
        'Mark done',
        'Copy link',
        'Remind me',
        'Search email',
        'Filter email',
      ])
        await expect(
          here.getByRole('listitem').filter({ hasText: shortcut })
        ).toHaveCount(1);
      await expect(
        sheet.getByRole('region', { name: 'Everywhere' })
      ).toBeVisible();
      saw('STL-976');
      await page.keyboard.press('Escape');
      await expect(sheet).toHaveCount(0);

      await page.getByRole('button', { name: 'Settings' }).first().click();
      await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
      await expect(page).toHaveURL(/\/app\/settings\/shortcuts/);
      await expect(
        page.getByRole('heading', { name: 'Email', exact: true })
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { name: 'Email drafts', exact: true })
      ).toBeVisible();
      for (const shortcut of [
        'Search email',
        'Star or unstar',
        'Mute or unmute',
        'Discard draft',
        'Attach files',
      ])
        await expect(
          page.getByText(shortcut, { exact: true }).first()
        ).toBeVisible();
      saw('STX-317');
    });
  });
}

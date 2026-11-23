// Settings › Email beyond its own controls: backing out of the two questions
// an inbox's row asks (remove it, turn its calendar off) and the buttons that
// lead to the related settings pages.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { anInbox, PROVIDERS } from './harness/providers';
import { grantCalendar, links, SETTINGS } from './harness/ways-settings';
import { openSettled } from './harness/ways-settings-more';
import { did } from './ledger/record';

test.beforeEach(({ page }) => loadAppSteadily(page));

for (const provider of PROVIDERS) {
  test.describe(`Settings › Email of ${anInbox(provider)}`, () => {
    test.use({ provider });

    // When this fails, Cancel in "Remove inbox" or "Turn off calendar" does
    // what it was asked not to (the inbox is gone, its calendar is off), or
    // the dialog stays open over the page.
    test('Cancel in Remove inbox and in Turn off calendar leaves the inbox as it was', async ({
      page,
      mailbox,
    }) => {
      const own = mailbox.inbox.email;
      if (provider === 'GMAIL') await grantCalendar(mailbox);
      const before = await links(mailbox);
      expect(before.map((link) => link.email_address)).toEqual([own]);
      expect(before[0].calendar_disabled).toBe(false);
      await openSettled(page, mailbox);

      for (const { open, title, id } of [
        { open: `Remove ${own}`, title: 'Remove inbox', id: 'AX-012' as const },
        {
          open: `Turn off calendar for ${own}`,
          title: 'Turn off calendar',
          id: 'AX-008' as const,
        },
      ]) {
        await page.getByRole('button', { name: open }).click();
        const dialog = page.getByRole('dialog', { name: title });
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        did(id);
        await expect(dialog).toBeHidden();
        await expect(page.getByRole('button', { name: open })).toBeVisible();
      }
      expect(await links(mailbox)).toEqual(before);
    });

    // When this fails, a button under "Related settings" does nothing or
    // opens some other page than the one it names.
    test('Manage notifications and Manage calendars open those settings pages', async ({
      page,
      mailbox,
    }) => {
      for (const { button, id, url, heading } of [
        {
          button: 'Manage notifications',
          id: 'AX-015' as const,
          url: /\/settings\/notifications$/,
          heading: 'Notifications',
        },
        {
          button: 'Manage calendars',
          id: 'AX-016' as const,
          url: /\/settings\/calendar$/,
          heading: 'Calendar',
        },
      ]) {
        await mailbox.open(SETTINGS);
        await page.getByRole('button', { name: button }).click();
        did(id);
        await expect(page).toHaveURL(url);
        await expect(
          page.getByRole('heading', { name: heading, level: 1 })
        ).toBeVisible();
      }
    });
  });
}

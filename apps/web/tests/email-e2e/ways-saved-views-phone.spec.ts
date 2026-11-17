// Saved views on a phone: the pill beside Filters opens a drawer of them,
// whose empty state starts the builder, whose rows open a view, and whose
// row menus move a view up and down. Each for a Gmail and an Outlook inbox.

import { devices } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import {
  listedNames,
  storedNames,
  storedView,
  storeView,
  viewRow,
} from './harness/ways-saved-views';
import { did } from './ledger/record';

const { defaultBrowserType: _browser, ...phone } = devices['iPhone 13'];
const from = 'Grace <grace@example.com>';

for (const provider of PROVIDERS) {
  test.describe(`saved views on a phone, ${anInbox(provider)}`, () => {
    test.use({ ...phone, provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a phone has no way to its saved views: the pill
    // opens no drawer, its Create view starts no builder, a tapped view
    // does not open with its mail, or Move up and Move down keep no order.
    test('the pill opens the drawer, which creates a view, opens one, and moves one up and down', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Alpha', text: 'Body of Alpha.' });
      await mailbox.deliver({ from, subject: 'Beta', text: 'Body of Beta.' });
      const alpha = await mailbox.synced('Alpha');
      const beta = await mailbox.synced('Beta');
      const drawer = page.getByRole('dialog', { name: 'Saved views' });
      const builder = page.getByRole('dialog', { name: 'Save view' });
      const pill = (name: string) =>
        page.getByRole('button', { name, exact: true });

      await mailbox.open();
      // The phone layout, not a desktop one squeezed by touch emulation.
      expect(await page.evaluate(() => window.innerWidth)).toBe(
        phone.viewport.width
      );
      await expect.poll(() => rowIds(page)).toEqual([beta.id, alpha.id]);

      await pill('Saved views').tap();
      did('AL-121');
      await expect(drawer.getByText('Your go-to views')).toBeVisible();
      await drawer.getByRole('button', { name: 'Create view' }).tap();
      did('AL-703');
      // The drawer goes before the builder comes.
      await expect(drawer).toHaveCount(0);
      await builder.getByRole('textbox', { name: 'Name' }).fill('Alpha mail');
      await builder
        .getByRole('textbox', { name: 'Subject contains' })
        .fill('Alpha');
      await builder.getByRole('button', { name: 'Save view' }).tap();
      await expect(builder).toHaveCount(0);
      await expect
        .poll(async () => (await storedView(mailbox, 'Alpha mail'))?.filters)
        .toMatchObject({ subject: ['Alpha'] });
      // The new view opens: the pill carries its name, the list its mail.
      await expect(pill('Alpha mail')).toBeVisible();
      await expect.poll(() => rowIds(page)).toEqual([alpha.id]);

      // A second view, made elsewhere, shows once the app loads again.
      await storeView(mailbox, 'Beta mail', { subject: ['Beta'] });
      const stored = await storedNames(mailbox);
      expect([...stored].sort()).toEqual(['Alpha mail', 'Beta mail']);
      await page.reload();
      await expect.poll(() => rowIds(page)).toEqual([alpha.id]);
      await pill('Alpha mail').tap();
      await expect.poll(() => listedNames(page)).toEqual(stored);
      await viewRow(page, 'Beta mail').tap();
      did('AL-702');
      await expect(drawer).toHaveCount(0);
      await expect(pill('Beta mail')).toBeVisible();
      await expect(page).toHaveURL(/savedView=/);
      await expect.poll(() => rowIds(page)).toEqual([beta.id]);

      // The lower view moves up, and down again, through its row's menu.
      const [upper, lower] = stored;
      await pill('Beta mail').tap();
      await drawer.getByRole('button', { name: `Actions for ${lower}` }).tap();
      await page.getByRole('menuitem', { name: 'Move up' }).tap();
      did('AL-115');
      await expect.poll(() => listedNames(page)).toEqual([lower, upper]);
      await expect.poll(() => storedNames(mailbox)).toEqual([lower, upper]);
      await drawer.getByRole('button', { name: `Actions for ${lower}` }).tap();
      await page.getByRole('menuitem', { name: 'Move down' }).tap();
      await expect.poll(() => listedNames(page)).toEqual([upper, lower]);
      await expect.poll(() => storedNames(mailbox)).toEqual([upper, lower]);
    });
  });
}

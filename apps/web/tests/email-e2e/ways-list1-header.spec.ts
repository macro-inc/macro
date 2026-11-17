// The list header's other ways in: Ctrl+F to the search field, f to the
// filter menu, Revert and Save view once a tab's filters changed, and the
// header's own New button. For a Gmail and an Outlook inbox. (`/` opens the
// app's Search view from Email, as from every other view.)

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { deliverNoise } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import {
  closeMenus,
  expectRows,
  filterMenu,
  filterSubmenu,
  GRACE,
  pickFilter,
  storedViews,
} from './harness/ways-list1';
import { confirmed, did } from './ledger/record';

for (const provider of PROVIDERS) {
  test.describe(`the list header of ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a key of the list header is dead (Ctrl+F does not
    // reach the search field, f does not open the filter menu), Revert
    // leaves the changed filters, Save view stores no view or one without
    // the filters, or the header's New button opens no composer.
    test('Ctrl+F, f, Revert, Save view and New each do their work', async ({
      page,
      mailbox,
    }) => {
      await deliverNoise(mailbox, {
        from: 'Deals <deals@example.com>',
        subject: 'Sale',
        text: 'Everything must go.',
      });
      await mailbox.deliver({ from: GRACE, subject: 'Lunch?', text: 'Noon?' });
      const lunch = (await mailbox.synced('Lunch?')).id;
      const sale = (await mailbox.synced('Sale')).id;
      // The search service is not part of the stack: what the list asks it
      // is caught here, as list-search.spec.ts does.
      const asked: string[] = [];
      await page.route(/\/dss\/search(\?|$)/, (route) => {
        asked.push(route.request().postData() ?? '');
        return route.fulfill({ json: { results: [], next_cursor: null } });
      });
      const field = page.getByRole('searchbox', { name: 'Search email' });
      const changed = page.getByRole('group', { name: 'Saved view actions' });

      await mailbox.open();
      await expectRows(page, [lunch]);

      await page.keyboard.press('ControlOrMeta+f');
      did('AL-015');
      await expect(field).toBeFocused();
      await page.keyboard.type('zeppelin');
      await expect.poll(() => asked.at(-1) ?? '').toContain('zeppelin');
      // Escape leaves the field with the search kept; Escape again, in the
      // list, clears it.
      await page.keyboard.press('Escape');
      await expect(field).not.toBeFocused();
      await page.keyboard.press('Escape');
      await expectRows(page, [lunch]);

      // Clearing folds the field back into its button: f is no longer typed.
      await expect(field).toHaveCount(0);
      await expect(
        page.getByRole('main').getByRole('button', { name: 'Search email' })
      ).toBeVisible();
      await page.keyboard.press('f');
      did('AL-019');
      await expect(filterMenu(page)).toBeVisible();
      // The menu f opened filters like the one the button opens.
      await filterMenu(page)
        .getByRole('menuitem', { name: 'Importance', exact: true })
        .click();
      await filterSubmenu(page, 'Importance')
        .getByRole('menuitemradio', { name: 'Noise', exact: true })
        .click();
      await expectRows(page, [sale]);
      await closeMenus(page);

      await changed.getByRole('button', { name: 'Revert' }).click();
      did('AL-108');
      await expectRows(page, [lunch]);
      await expect(changed).toHaveCount(0);

      await pickFilter(page, 'Importance', 'menuitemradio', 'Noise');
      await expectRows(page, [sale]);
      await closeMenus(page);
      await changed.getByRole('button', { name: 'Save view' }).click();
      did('AL-107');
      const builder = page.getByRole('dialog', { name: 'Save view' });
      await builder.getByRole('textbox', { name: 'Name' }).fill('Noise only');
      await builder.getByRole('button', { name: 'Save view' }).click();
      await expect(builder).toHaveCount(0);
      await expect
        .poll(async () =>
          (await storedViews(mailbox)).map((view) => ({
            name: view.name,
            importance: view.filters.importance,
          }))
        )
        .toEqual([{ name: 'Noise only', importance: 'noise' }]);
      confirmed('F-045');
      await expectRows(page, [sale]);

      await page
        .getByRole('main')
        .getByRole('button', { name: 'New email' })
        .click();
      did('AL-011');
      await expect(page.getByRole('textbox', { name: 'Subject' })).toHaveValue(
        ''
      );
      await expect(
        page.getByRole('button', { name: 'Send email' })
      ).toBeVisible();
    });
  });
}

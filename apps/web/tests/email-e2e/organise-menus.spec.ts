// The menus that hold a thread's actions: a row's context menu, the command
// menu for a row or a selection, and the menu after an open thread's
// subject. Each for a Gmail and an Outlook inbox.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { deliverNoise, rowIds } from './harness/list';
import type { Provider } from './harness/stack';
import { did, saw } from './ledger/record';

/** The row of a thread in the list. */
function row(page: Page, threadId: string) {
  return page.locator(`[data-soup-entity] [data-entity-id="${threadId}"]`);
}

const PROVIDERS: Provider[] = ['GMAIL', 'OUTLOOK'];

for (const provider of PROVIDERS) {
  test.describe(`the action menus of a thread in ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a right-click on a row opens no menu, or one whose
    // items do not follow the row: no Mark Done in the inbox, or the sender
    // move towards the tab the row is already in.
    test('a right-click on a row opens its menu, with the sender move of its tab', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Agenda',
        text: 'About Agenda.',
      });
      await deliverNoise(mailbox, {
        from: 'Deals <deals@example.com>',
        subject: 'Sale',
        text: 'Everything must go.',
      });
      const agenda = await mailbox.synced('Agenda');
      const sale = await mailbox.synced('Sale');
      const menu = page.getByRole('menu');
      const item = (name: string | RegExp) =>
        menu.getByRole('menuitem', { name });

      await mailbox.open();
      await expect.poll(() => rowIds(page)).toEqual([agenda.id]);
      await row(page, agenda.id).click({ button: 'right' });
      did('AL-604');
      await expect(item(/^Mark Done/)).toBeVisible();
      await expect(item(/^Move to folder/)).toBeVisible();
      await expect(item('Block Sender')).toBeVisible();
      await expect(item('Sender → Noise')).toBeVisible();
      await expect(item('Sender → Signal')).toHaveCount(0);
      saw('STL-602');
      await menu.press('Escape');
      await expect(menu).toHaveCount(0);

      await page
        .getByRole('radiogroup', { name: 'Inbox view' })
        .getByText('Noise', { exact: true })
        .click();
      await expect.poll(() => rowIds(page)).toEqual([sale.id]);
      await row(page, sale.id).click({ button: 'right' });
      await expect(item(/^Mark Done/)).toBeVisible();
      await expect(item('Sender → Signal')).toBeVisible();
      await expect(item('Sender → Noise')).toHaveCount(0);
      saw('STL-602');
    });

    // When this fails, the lightning button of a row or Cmd+K on a selection
    // opens nothing, or the general command menu instead of the actions of
    // the threads.
    test('the command menu lists the actions of a row, and of a selection', async ({
      page,
      mailbox,
    }) => {
      for (const subject of ['Agenda', 'Minutes']) {
        await mailbox.deliver({
          from: 'Grace <grace@example.com>',
          subject,
          text: `About ${subject}.`,
        });
      }
      const agenda = await mailbox.synced('Agenda');
      const minutes = await mailbox.synced('Minutes');
      const search = page.getByRole('textbox', { name: 'Search actions...' });
      const results = page.getByRole('listbox', { name: 'Search results' });
      const actions = async () => {
        await expect(search).toBeVisible();
        await expect(
          results.getByRole('option', { name: /^Mark done/ })
        ).toBeVisible();
        await expect(
          results.getByRole('option', { name: /^Delete item/ })
        ).toBeVisible();
        // The commands of the app at large are not offered.
        await expect(
          results.getByRole('option', { name: 'Change theme' })
        ).toHaveCount(0);
      };

      await mailbox.open();
      await expect
        .poll(async () => (await rowIds(page)).sort())
        .toEqual([agenda.id, minutes.id].sort());
      await row(page, agenda.id).hover();
      await row(page, agenda.id)
        .getByRole('button', { name: 'Open command menu' })
        .click();
      did('AL-600');
      await actions();
      await expect(page.getByRole('dialog').getByText('Agenda')).toBeVisible();
      saw('STL-606');
      await page.keyboard.press('Escape');
      await expect(search).toHaveCount(0);

      for (const id of [agenda.id, minutes.id]) {
        await row(page, id).hover();
        await row(page, id)
          .getByRole('checkbox', { name: 'Select item' })
          .click();
      }
      await expect(page.getByText('2 selected')).toBeVisible();
      await page.keyboard.press('ControlOrMeta+k');
      did('AL-076');
      await actions();
      saw('STL-606');
    });

    // When this fails, the button after an open thread's subject opens no
    // menu, or one without the thread's actions.
    test('the menu after the subject of an open thread lists its actions', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Agenda',
        text: 'About Agenda.',
      });
      const agenda = await mailbox.synced('Agenda');
      const menu = page.getByRole('menu');

      await mailbox.open(`/app/mail/${agenda.id}`);
      await expect(page.getByText('About Agenda.')).toBeVisible();
      await page
        .getByRole('heading', { name: 'Agenda', level: 1 })
        .getByRole('button')
        .click();
      did('AL-148');
      for (const name of [
        /^Mark Done/,
        /^Mark Unread/,
        'Block Sender',
        /^Move to folder/,
        /^Delete/,
      ]) {
        await expect(menu.getByRole('menuitem', { name })).toBeVisible();
      }
    });
  });
}

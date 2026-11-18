// What the desktop sidebar's Saved views section shows besides its rows:
// the load in progress, a load that failed, no views at all, a second page
// on its way, a new order the service refused, the row menu's items, and a
// delete the service refused. Each for a Gmail and an Outlook inbox.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import {
  OperationGate,
  refusal,
  SERVER_DOWN,
} from './harness/states-saved-views';
import {
  listedNames,
  storedNames,
  storeView,
  viewList,
  viewRow,
} from './harness/ways-saved-views';
import { saw } from './ledger/record';

const from = 'Grace <grace@example.com>';

for (const provider of PROVIDERS) {
  test.describe(`the Saved views section's states, with ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, the section says nothing while its views load, a
    // failed load leaves no way to ask again, or an account without views is
    // not told how to make one.
    test('the section says it is loading, offers Retry after a failed load, then invites a first view', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Alpha', text: 'Body of Alpha.' });
      const alpha = await mailbox.synced('Alpha');
      const views = await OperationGate.on(page, 'SavedViews');
      const loading = page
        .getByRole('status')
        .filter({ hasText: 'Loading views…' });
      const retry = page.getByRole('button', { name: 'Retry loading views' });

      // The list of views is held on its way, so nothing is loaded yet.
      views.hold();
      await mailbox.open();
      await expect.poll(() => rowIds(page)).toEqual([alpha.id]);
      await expect.poll(() => views.held).toBe(1);
      await expect(loading).toBeVisible();
      saw('STL-055');

      // The service is down for that load and every one after it.
      views.refuse(SERVER_DOWN);
      await expect(retry).toBeVisible();
      await expect(loading).toHaveCount(0);
      await expect(viewList(page).getByRole('button')).toHaveCount(0);
      saw('STL-057');

      // The app asks again by itself every few seconds; the click comes
      // right after one of those, so it is Retry that loads the views.
      const quiet = views.sent;
      await expect.poll(() => views.sent).toBeGreaterThan(quiet);
      views.pass();
      await retry.click();
      await expect(page.getByText('Your go-to views')).toBeVisible();
      await expect(
        page.getByText(
          'Save a set of senders, subjects, or filters to triage first.'
        )
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Create view' })
      ).toBeVisible();
      await expect(retry).toHaveCount(0);
      saw('STL-056');
    });

    // When this fails, Load more views can be pressed again while the next
    // page loads, a refused new order stays on screen as if it were kept,
    // desktop row menus offer Move items the drag already does, or a refused
    // delete closes its confirmation without saying why.
    test('Load more waits for its page, a refused order goes back, and a refused delete says why', async ({
      page,
      mailbox,
    }) => {
      for (let number = 1; number <= 51; number++) {
        await storeView(mailbox, `View ${number}`, { subject: ['Alpha'] });
      }
      const stored = await storedNames(mailbox);
      expect(stored).toHaveLength(51);
      const [first, second] = stored;
      const nextPage = await OperationGate.on(
        page,
        'SavedViews',
        (variables) => typeof variables.after === 'string'
      );
      const reorder = await OperationGate.on(page, 'ReorderSavedViews');
      const remove = await OperationGate.on(page, 'DeleteSavedView');
      const more = page.getByRole('button', { name: 'Load more views' });

      await mailbox.open();
      await expect.poll(() => listedNames(page)).toEqual(stored.slice(0, 50));

      // The second page is held on its way.
      nextPage.hold();
      await more.click();
      await expect.poll(() => nextPage.held).toBe(1);
      await expect(more).toBeDisabled();
      saw('STL-703');
      nextPage.pass();
      await expect.poll(() => listedNames(page)).toEqual(stored);
      await expect(more).toHaveCount(0);

      // The second view dragged above the first, an order the service
      // refuses once it has been shown.
      reorder.hold();
      await viewRow(page, second).scrollIntoViewIfNeeded();
      const moved = await viewRow(page, second).boundingBox();
      const target = await viewRow(page, first).boundingBox();
      if (!moved || !target) throw new Error('the saved views are not shown');
      await page.mouse.move(
        moved.x + moved.width / 3,
        moved.y + moved.height / 2
      );
      await page.mouse.down();
      await page.mouse.move(target.x + target.width / 3, target.y + 2, {
        steps: 12,
      });
      await page.mouse.up();
      await expect
        .poll(async () => (await listedNames(page)).slice(0, 2))
        .toEqual([second, first]);
      await expect.poll(() => reorder.held).toBe(1);
      reorder.refuse(refusal('Saved views cannot be reordered right now.'));
      await expect(
        page.getByText('Saved views cannot be reordered right now.')
      ).toBeVisible();
      await expect.poll(() => listedNames(page)).toEqual(stored);
      saw('STL-059');

      // A desktop row menu: the drag moves views, so it has no Move items.
      await page
        .getByRole('button', { name: `Actions for ${first}`, exact: true })
        .click();
      await expect(
        page.getByRole('menuitem', { name: 'Delete view' })
      ).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Move up' })).toHaveCount(
        0
      );
      await expect(
        page.getByRole('menuitem', { name: 'Move down' })
      ).toHaveCount(0);
      saw('STL-711');

      // Its Delete view, refused by the service.
      remove.refuse(refusal('This saved view cannot be deleted right now.'));
      await page.getByRole('menuitem', { name: 'Delete view' }).click();
      const confirmation = page
        .getByRole('alertdialog')
        .or(page.getByRole('dialog'))
        .filter({ hasText: `Delete “${first}”?` });
      await confirmation.getByRole('button', { name: 'Delete view' }).click();
      await expect(confirmation.getByRole('alert')).toHaveText(
        'This saved view cannot be deleted right now.'
      );
      saw('STL-709');
      await confirmation.getByRole('button', { name: 'Cancel' }).click();
      await expect(confirmation).toHaveCount(0);
      expect(await storedNames(mailbox)).toEqual(stored);
    });
  });
}

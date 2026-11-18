import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { trashFolder } from './harness/journeys';
import { focusRow, rowIds } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import { notice } from './harness/send';
import { deliverAll, folderOf, held, rowMenu } from './harness/ways-organise';
import { folderName, pickFolder, readAt } from './harness/ways-organise-more';
import { SETTINGS, storedSignature } from './harness/ways-settings';
import { confirmed, did, saw } from './ledger/record';

for (const provider of PROVIDERS) {
  for (const proof of ['pending', 'unavailable'] as const) {
    test.describe(`personal mail in ${anInbox(provider)} with CRM proof ${proof}`, () => {
      test.use({ provider });
      test.beforeEach(async ({ page }) => {
        await loadAppSteadily(page);
        await page.route('**/dss/crm/member-access', async (route) => {
          if (proof === 'unavailable')
            await route.fulfill({ status: 503, body: 'Unavailable' });
          // Leave the first proof pending for the lifetime of this page.
        });
      });

      // CRM proof must not prevent an inbox-owned settings write or its notice.
      test('saves a signature without waiting for CRM access', async ({
        page,
        mailbox,
      }) => {
        await mailbox.open(SETTINGS);
        await page
          .getByRole('tablist', {
            name: `Signature views for ${mailbox.inbox.email}`,
          })
          .getByRole('tab', { name: 'HTML' })
          .click();
        const save = page.getByRole('button', { name: 'Save signature' });
        await expect(async () => {
          await page
            .getByRole('textbox', {
              name: `Signature HTML for ${mailbox.inbox.email}`,
            })
            .fill('<p>Test signature</p>');
          await expect(save).toBeEnabled({ timeout: 2_000 });
        }).toPass();
        did('AX-021');
        await save.click();
        did('AX-024');
        await expect(notice(page, 'Signature saved')).toBeVisible();
        saw('STX-015', 'F-148');
        await expect
          .poll(() => storedSignature(mailbox))
          .toContain('Test signature');
        confirmed('F-148');
      });

      // A successful inbox mutation must update the list even without CRM proof.
      test('publishes read and unread changes without CRM access', async ({
        page,
        mailbox,
      }) => {
        const ids = await deliverAll(mailbox, ['Agenda']);
        await mailbox.open();
        await expect.poll(() => rowIds(page)).toContain(ids.Agenda);
        await rowMenu(page, ids.Agenda, /^Mark Read/);
        did('AL-079', 'F-068');
        await expect.poll(readAt(mailbox, 'Agenda')).toBe(true);
        // The menu reads the live cache record, so the reverse action proves
        // the successful response was published as well as stored by the server.
        await rowMenu(page, ids.Agenda, /^Mark Unread/);
        did('AL-079', 'F-069');
        await expect.poll(readAt(mailbox, 'Agenda')).toBe(false);
      });

      // The row must keep receiving favorite changes after identity is bound.
      test('publishes star changes without CRM access', async ({
        page,
        mailbox,
      }) => {
        const ids = await deliverAll(mailbox, ['Agenda']);
        await mailbox.open();
        await focusRow(page, ids.Agenda);
        await page.keyboard.press('s');
        did('AL-061', 'F-073');
        await expect(notice(page, 'Added to favorites')).toBeVisible();
        const row = page.locator(
          `[data-soup-entity] [data-entity-id="${ids.Agenda}"]`
        );
        await row.hover();
        const unstar = row.getByRole('button', { name: 'Unstar email' });
        await expect(unstar).toBeVisible();
        await expect
          .poll(async () => {
            const response = await mailbox.api('/dss/favorites');
            return response.json();
          })
          .toMatchObject({
            favorites: [expect.objectContaining({ entityId: ids.Agenda })],
          });
        await unstar.click();
        did('AL-060', 'F-074');
        await expect(notice(page, 'Removed from favorites')).toBeVisible();
        saw('STL-048', 'F-074');
        await expect(
          row.getByRole('button', { name: 'Star email' })
        ).toBeVisible();
        await expect
          .poll(async () => {
            const response = await mailbox.api('/dss/favorites');
            return response.json();
          })
          .toMatchObject({ favorites: [] });
        confirmed('F-074');
      });

      // Provider labels and the mounted list must agree before any CRM proof.
      test('publishes a Trash label change without CRM access', async ({
        page,
        mailbox,
      }) => {
        const ids = await deliverAll(mailbox, ['Agenda', 'Kept']);
        await mailbox.open();
        await expect.poll(() => rowIds(page)).toContain(ids.Agenda);
        await rowMenu(page, ids.Agenda, /^Delete/);
        did('AL-089');
        await expect
          .poll(async () => (await held(mailbox, 'Agenda'))?.labels)
          .toContain(trashFolder(provider));
        await expect.poll(() => rowIds(page)).not.toContain(ids.Agenda);
        await expect.poll(() => rowIds(page)).toContain(ids.Kept);
      });

      // Folder moves return only the owner-authorized thread and its folders.
      test('files a thread without waiting for CRM access', async ({
        page,
        mailbox,
      }) => {
        const ids = await deliverAll(mailbox, ['Agenda']);
        await mailbox.open();
        await expect.poll(() => rowIds(page)).toContain(ids.Agenda);
        await rowMenu(page, ids.Agenda, /^Move to folder/);
        did('AL-091');
        await pickFolder(page, 'Receipts', /^New folder/);
        await expect
          .poll(async () =>
            folderName(mailbox, await folderOf(mailbox, ids.Agenda))
          )
          .toBe('Receipts');
        await notice(page, 'Moved to folder')
          .getByRole('button', { name: 'Open', exact: true })
          .click();
        await expect(page.getByText('Agenda', { exact: true })).toBeVisible();
        saw('STL-968');
        saw('STL-947');
      });
    });
  }
}

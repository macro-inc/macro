// A thread shared between two people: the owner sees who has access and
// takes it away, the other person opens the thread to read, and a request
// for access is granted by the owner. Each for a Gmail and an Outlook inbox.
//
// Sharing with a person is sent through the channels service, which the
// stack does not run, so the grant a share makes is written to the database
// here. A thread offers no way to ask for access in the app (only view
// access exists, and the dialog is reached by someone who already has it),
// so the request is made at the storage service; granting it is done in the
// app.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import {
  answerSharingAsUser,
  apiKey,
  grantView,
  readStatus,
  sharingApi,
  threadOf,
} from './harness/sharing';
import { confirmed, did, saw } from './ledger/record';

for (const provider of PROVIDERS) {
  test.describe(`sharing a thread of ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, the owner of a shared thread cannot see who reads it,
    // or taking a person's access away leaves them reading it.
    test('the owner sees who a thread is shared with and takes their access away', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Agenda',
        text: 'About Agenda.',
      });
      const agenda = await mailbox.synced('Agenda');
      const bob = await mailbox.stack.user('bob@example.com');
      await grantView(mailbox, agenda.id, bob);
      expect(await readStatus(mailbox, bob, agenda.id)).toBe(200);
      await answerSharingAsUser(page, mailbox);
      const dialog = page.getByRole('dialog', { name: 'Share: Agenda' });

      await mailbox.open(`/app/mail/${agenda.id}`);
      await expect(page.getByText('About Agenda.')).toBeVisible();
      await page
        .getByRole('group', { name: 'Sharing' })
        .getByRole('button', { name: 'Share', exact: true })
        .click();
      did('AL-131');
      await expect(
        dialog.getByText('People with access to this email thread')
      ).toBeVisible();
      await expect(dialog.getByText('Owner', { exact: true })).toBeVisible();
      await expect(dialog.getByText('bob@example.com')).toBeVisible();
      await expect(
        dialog.getByRole('button', { name: "Person's access level" })
      ).toHaveText('View');
      saw('STL-622');
      // A thread is shared with people, never by a link.
      await expect(dialog.getByText(/link/i)).toHaveCount(0);
      saw('STL-623');

      await dialog.getByRole('button', { name: 'Remove access' }).click();
      did('AL-619');
      await expect(dialog.getByText('bob@example.com')).toHaveCount(0);
      await expect(dialog.getByText('Owner', { exact: true })).toBeVisible();

      // The service holds no grant for the person, and refuses them the
      // thread. Not marked as confirming F-158: the share itself was written
      // to the database (sharing with people or channels needs the channels
      // service), so only taking access away went through the app and the
      // function stays covered in part.
      const grants = await sharingApi(
        mailbox,
        await apiKey(mailbox, bob),
        agenda.id,
        'direct-access'
      );
      expect(grants.status).toBe(403);
      expect(await readStatus(mailbox, bob, agenda.id)).toBe(401);
    });

    // When this fails, a thread someone shared does not open from Shared, or
    // it offers the reader the controls that change the owner's mailbox.
    test('a thread someone else shared opens to read, without the controls of an own thread', async ({
      page,
      mailbox,
    }) => {
      const bob = await mailbox.stack.user('bob@example.com');
      await mailbox.stack.link(bob, provider);
      await mailbox.stack.deliver('bob@example.com', {
        from: 'Hugo <hugo@example.com>',
        subject: 'Budget',
        text: 'About Budget.',
      });
      const budget = await threadOf(mailbox, 'bob@example.com');
      expect(await readStatus(mailbox, mailbox.user, budget)).toBe(401);
      await grantView(mailbox, budget, mailbox.user);

      await mailbox.open();
      await page
        .getByRole('navigation', { name: 'Email library' })
        .getByRole('button', { name: 'Shared' })
        .click();
      await expect.poll(() => rowIds(page)).toEqual([budget]);
      await page
        .getByRole('grid', { name: 'Email' })
        .getByText('Budget', { exact: true })
        .click();
      did('AL-902');
      await expect(page.getByText('About Budget.')).toBeVisible();
      await expect(page).toHaveURL(new RegExp(budget));
      await expect(
        page.getByRole('group', { name: 'Sharing' }).getByRole('button', {
          name: 'Share',
          exact: true,
        })
      ).toBeVisible();
      for (const name of ['Remind me', 'Mark as unread', 'Mark done']) {
        await expect(page.getByRole('button', { name })).toHaveCount(0);
      }
      saw('STL-608');

      const menu = page.getByRole('menu');
      await page
        .getByRole('heading', { name: 'Budget', level: 1 })
        .getByRole('button')
        .click();
      await expect(menu.getByRole('menuitem').first()).toBeVisible();
      for (const name of [
        /^Mark Done/,
        /^Move to folder/,
        /^Delete/,
        'Block Sender',
      ]) {
        await expect(menu.getByRole('menuitem', { name })).toHaveCount(0);
      }
      saw('STL-618');

      // The email service gives the reader the thread, at view access: what
      // the grant written above does, true before the click, so it confirms
      // nothing about opening the thread.
      const answer = await mailbox.api(
        `/email/email/threads/${budget}?limit=1`
      );
      expect(answer.status).toBe(200);
      const { thread } = (await answer.json()) as {
        thread: { db_id: string; access_level: string };
      };
      expect(thread).toMatchObject({ db_id: budget, access_level: 'view' });
    });

    // When this fails, the owner of a thread is not shown a request for
    // access to it, or granting it leaves the person without the thread.
    test('a request for access to a thread is granted by its owner', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Plans',
        text: 'About Plans.',
      });
      const plans = await mailbox.synced('Plans');
      const bob = await mailbox.stack.user('bob@example.com');
      const asked = await sharingApi(
        mailbox,
        await apiKey(mailbox, bob),
        plans.id,
        'access-requests/mine',
        { method: 'PUT', body: JSON.stringify({ requestedLevel: 'view' }) }
      );
      expect(asked.status).toBe(200);
      expect(await readStatus(mailbox, bob, plans.id)).toBe(401);
      await answerSharingAsUser(page, mailbox);
      const dialog = page.getByRole('dialog', { name: 'Share: Plans' });
      const requests = dialog.getByRole('region', {
        name: 'Permission requests',
      });

      // A thread with a request waiting opens its Share dialog by itself.
      await mailbox.open(`/app/mail/${plans.id}`);
      await expect(
        requests.getByRole('heading', { name: 'Permission requests (1)' })
      ).toBeVisible();
      await expect(requests.getByText('bob@example.com')).toBeVisible();
      await expect(requests.getByText(/^Requested view access/)).toBeVisible();
      saw('STL-943');

      await requests.getByRole('button', { name: 'Grant access' }).click();
      did('AL-905');
      await expect(requests).toHaveCount(0);
      await expect(dialog.getByText('bob@example.com')).toBeVisible();
      await expect(
        dialog.getByRole('button', { name: "Person's access level" })
      ).toHaveText('View');
      saw('STL-944');

      // The service has settled the request and gives the person the thread.
      const settled = await mailbox.stack.sql<{ status: string }>(
        `SELECT status FROM entity_access_request WHERE entity_id = '${plans.id}'::uuid`
      );
      expect(settled).toEqual([{ status: 'granted' }]);
      expect(await readStatus(mailbox, bob, plans.id)).toBe(200);
      confirmed('F-160');
    });
  });
}

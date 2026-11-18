// Other ways to act on a thread from its row: the row's Archive button,
// Shift+E on a done thread, the three keys that discard a draft, Share from
// the command menu, and on a phone a swipe to the right for Remind me. Each
// for a Gmail and an Outlook inbox.

import { devices } from '@playwright/test';
import { composeNew, draftThreads, loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { focusRow } from './harness/list';
import { followup } from './harness/organise';
import { anInbox, PROVIDERS } from './harness/providers';
import { answerSharingAsUser, grantView } from './harness/sharing';
import {
  deliverThreads,
  held,
  listShows,
  row,
  rowCheckbox,
  swipeRow,
} from './harness/ways-list2';
import { confirmed, did } from './ledger/record';

const { defaultBrowserType: _browser, ...phone } = devices['iPhone 13'];

/** The keys that discard the draft of the row under the cursor. */
const DISCARD_KEYS = ['Period', 'Comma', 'KeyD'] as const;

for (const provider of PROVIDERS) {
  test.describe(`other ways to act on a row of ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, the row's Archive button leaves the thread in the
    // inbox at the provider, or Shift+E on a done thread does not bring it
    // back there.
    test("the row's Archive button marks a thread done and Shift+E not done", async ({
      page,
      mailbox,
    }) => {
      const ids = await deliverThreads(mailbox, ['Agenda', 'Minutes']);

      await mailbox.open();
      await listShows(page, Object.values(ids));
      await row(page, ids.Agenda).hover();
      await row(page, ids.Agenda)
        .getByRole('button', { name: 'Archive email' })
        .click();
      did('AL-062');
      await listShows(page, [ids.Minutes]);
      await expect
        .poll(async () => (await held(mailbox, 'Agenda'))?.inInbox)
        .toBe(false);
      confirmed('F-071');

      await page
        .getByRole('navigation', { name: 'Email library' })
        .getByRole('button', { name: 'Archived' })
        .click();
      await listShows(page, [ids.Agenda]);
      await focusRow(page, ids.Agenda);
      await page.keyboard.press('Shift+E');
      did('AL-065');
      await expect
        .poll(async () => (await held(mailbox, 'Agenda'))?.inInbox)
        .toBe(true);
      confirmed('F-072');
      expect((await held(mailbox, 'Minutes'))?.inInbox).toBe(true);
    });

    // When this fails, one of Cmd+Shift+. , Cmd+Shift+, and Cmd+Shift+D on a
    // draft's row does nothing, or takes the row away while the email
    // service keeps the draft.
    test('each discard key on a draft row removes the stored draft', async ({
      page,
      mailbox,
    }) => {
      const subjects = DISCARD_KEYS.map((key) => `Draft for ${key}`);
      const stored = async () =>
        (await draftThreads(mailbox)).map((thread) => thread.name).sort();
      for (const subject of subjects) {
        await composeNew(page, mailbox, {
          to: 'grace@example.com',
          subject,
          body: 'Not sure yet.',
        });
        await expect.poll(stored).toContain(subject);
      }
      const drafts = await draftThreads(mailbox);

      await mailbox.open();
      await page
        .getByRole('navigation', { name: 'Email tabs' })
        .getByRole('button', { name: 'Drafts' })
        .click();
      await listShows(
        page,
        drafts.map((thread) => thread.id)
      );
      for (const [index, key] of DISCARD_KEYS.entries()) {
        const draft = drafts.find((thread) => thread.name === subjects[index]);
        if (!draft) throw new Error(`no draft named ${subjects[index]}`);
        await focusRow(page, draft.id);
        await page.keyboard.press(`Shift+ControlOrMeta+${key}`);
        did('AL-069');
        await expect
          .poll(stored, { message: `the draft outlived ${key}` })
          .toEqual(subjects.slice(index + 1).sort());
        await expect(row(page, draft.id)).toHaveCount(0);
      }
      confirmed('F-119');
    });

    // When this fails, Share in the command menu of a selected row opens no
    // Share dialog, or one that does not show who the service says has
    // access to that thread.
    test('Share in the command menu opens the Share dialog of the thread', async ({
      page,
      mailbox,
    }) => {
      const ids = await deliverThreads(mailbox, ['Agenda', 'Minutes']);
      const bob = await mailbox.stack.user('bob@example.com');
      await grantView(mailbox, ids.Agenda, bob);
      await answerSharingAsUser(page, mailbox);
      const search = page.getByRole('textbox', { name: 'Search actions...' });
      const dialog = page.getByRole('dialog', { name: 'Share: Agenda' });

      await mailbox.open();
      await listShows(page, Object.values(ids));
      await (await rowCheckbox(page, ids.Agenda)).click();
      await expect(page.getByText('1 selected')).toBeVisible();
      await page.keyboard.press('ControlOrMeta+k');
      await search.fill('Share');
      await page
        .getByRole('listbox', { name: 'Search results' })
        .getByRole('option', { name: /^Share/ })
        .click();
      did('AL-075');
      await expect(
        dialog.getByText('People with access to this email thread')
      ).toBeVisible();
      await expect(dialog.getByText('bob@example.com')).toBeVisible();
      await expect(
        dialog.getByRole('button', { name: "Person's access level" })
      ).toHaveText('View');
      confirmed('F-158');
    });
  });

  test.describe(`a swipe on a row of ${anInbox(provider)}, on a phone`, () => {
    test.use({ ...phone, provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a swipe to the right on a row opens no Remind me, or
    // the time picked there is not saved for that thread.
    test('a swipe to the right opens Remind me, and its choice is saved', async ({
      page,
      mailbox,
    }) => {
      const ids = await deliverThreads(mailbox, ['Lunch?', 'Minutes']);

      await mailbox.open();
      await listShows(page, Object.values(ids));
      await swipeRow(page, ids['Lunch?'], 200);
      did('AL-097');
      await page.getByRole('option', { name: /^Tomorrow/ }).tap();
      await expect
        .poll(() => followup(mailbox, ids['Lunch?']))
        .toMatchObject({ state: 'pending' });
      confirmed('F-090');
      expect(await followup(mailbox, ids.Minutes)).toBeFalsy();
    });
  });
}

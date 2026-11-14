// The other ways into a thread and out of it with something to paste: a
// split of its own beside the list, a link to the thread or to one of its
// messages, and its link, ID and subject on the clipboard. Each for a Gmail
// and an Outlook inbox.

import { devices, type Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { focusRow, rowIds } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import { notice } from './harness/send';
import { deliverThread, messageCard, threadMessages } from './harness/thread';
import { did, saw } from './ledger/record';

const { defaultBrowserType: _browser, ...phone } = devices['iPhone 13'];

/** The row of a thread in the list. */
function row(page: Page, threadId: string) {
  return page.locator(`[data-soup-entity] [data-entity-id="${threadId}"]`);
}

/** What the clipboard holds. */
function clipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

/** Delivers two threads, "Agenda" and "Minutes", and answers both. */
async function twoThreads(mailbox: Mailbox) {
  await mailbox.deliver({
    from: 'Grace <grace@example.com>',
    subject: 'Agenda',
    text: 'About Agenda.',
  });
  await mailbox.deliver({
    from: 'Hugo <hugo@example.com>',
    subject: 'Minutes',
    text: 'About Minutes.',
  });
  return {
    agenda: await mailbox.synced('Agenda'),
    minutes: await mailbox.synced('Minutes'),
  };
}

for (const provider of PROVIDERS) {
  test.describe(`opening and copying a thread of ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await loadAppSteadily(page);
    });

    // When this fails, Shift+click on a row opens the thread in place of the
    // list, or not at all, instead of in a split beside it.
    test('Shift+click opens the thread in a split of its own beside the list', async ({
      page,
      mailbox,
    }) => {
      const { agenda, minutes } = await twoThreads(mailbox);

      await mailbox.open();
      await expect
        .poll(() => rowIds(page))
        .toEqual(expect.arrayContaining([agenda.id, minutes.id]));
      await expect(page.getByRole('main')).toHaveCount(1);
      await row(page, agenda.id).click({ modifiers: ['Shift'] });
      did('AL-051');
      did('AX-324', 'F-054');
      await expect(page.getByText('About Agenda.')).toBeVisible();
      await expect(page.getByRole('main')).toHaveCount(2);
      await expect(page).toHaveURL(new RegExp(`/mail/${agenda.id}`));
      // The list stays beside it, with both rows.
      await expect(row(page, minutes.id)).toBeVisible();
      await expect(row(page, agenda.id)).toBeVisible();
      saw('STL-977');
    });

    // When this fails, a row's menu cannot open the thread in a new split,
    // or offers to when the window has no room for one more.
    test('the row menu opens the thread in a new split, and cannot when there is no room for one', async ({
      page,
      mailbox,
    }) => {
      const { agenda, minutes } = await twoThreads(mailbox);
      const item = page
        .getByRole('menu')
        .getByRole('menuitem', { name: /^Open in new split/ });

      await mailbox.open();
      await expect
        .poll(() => rowIds(page))
        .toEqual(expect.arrayContaining([agenda.id, minutes.id]));
      // A window too narrow for a second split.
      await page.setViewportSize({ width: 820, height: 800 });
      await row(page, minutes.id).click({ button: 'right' });
      await expect(item).toHaveAttribute('aria-disabled', 'true');
      saw('STL-603');
      await page.getByRole('menu').press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);

      await page.setViewportSize({ width: 1280, height: 720 });
      await row(page, minutes.id).click({ button: 'right' });
      await expect(item).not.toHaveAttribute('aria-disabled', 'true');
      await item.click();
      did('AL-090');
      await expect(page.getByText('About Minutes.')).toBeVisible();
      await expect(page.getByRole('main')).toHaveCount(2);
      await expect(row(page, agenda.id)).toBeVisible();
      saw('STL-977');
    });

    // When this fails, a link to a thread does not open it, or a link to one
    // of its messages opens the thread without bringing that message up:
    // it stays folded among the earlier ones.
    test('a link opens the thread, and a link to a message opens it at that message', async ({
      page,
      mailbox,
    }) => {
      const thread = await deliverThread(
        mailbox,
        'Trip',
        [
          { text: 'First about Trip.' },
          { text: 'Second about Trip.' },
          { text: 'Third about Trip.' },
          { text: 'Fourth about Trip.' },
        ],
        { aSecondApart: true }
      );
      const second = (await threadMessages(mailbox, thread.id)).find(
        (message) => message.body_text?.includes('Second about Trip.')
      );
      if (!second) throw new Error('no second message');
      // An open message names who it went to; a folded one does not.
      const secondOpen = messageCard(page, 'Second about Trip.').getByText(
        'to Me'
      );

      await mailbox.open(`/app/email/${thread.id}`);
      did('AX-324', 'F-055');
      await expect(page.getByText('Fourth about Trip.')).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/app/mail/${thread.id}$`));
      await expect(
        messageCard(page, 'Fourth about Trip.').getByText('to Me')
      ).toBeVisible();
      // Unread messages open by themselves: once the thread is read, only
      // the latest does.
      await expect
        .poll(async () =>
          (await threadMessages(mailbox, thread.id)).every(
            (message) => message.is_read
          )
        )
        .toBe(true);
      await mailbox.open(`/app/email/${thread.id}`);
      await expect(
        messageCard(page, 'Fourth about Trip.').getByText('to Me')
      ).toBeVisible();
      await expect(secondOpen).toHaveCount(0);

      await mailbox.open(
        `/app/email/${thread.id}?email_message_id=${second.db_id}`
      );
      did('AL-192', 'F-055');
      await expect(secondOpen).toBeVisible();
      await expect(secondOpen).toBeInViewport();
      await expect(page).toHaveURL(
        new RegExp(`/app/mail/${thread.id}\\?.*${second.db_id}`)
      );
      saw('STL-105', 'F-055');
      saw('STX-318');
    });

    // When this fails, Copy Link in a row's menu copies nothing or another
    // address than the thread's, or says nothing about it.
    test("Copy Link in the row menu puts the thread's link on the clipboard", async ({
      page,
      mailbox,
    }) => {
      const { agenda, minutes } = await twoThreads(mailbox);

      await mailbox.open();
      await expect
        .poll(() => rowIds(page))
        .toEqual(expect.arrayContaining([agenda.id, minutes.id]));
      await page.evaluate(() => navigator.clipboard.writeText('nothing yet'));
      await row(page, agenda.id).click({ button: 'right' });
      await page
        .getByRole('menu')
        .getByRole('menuitem', { name: /^Copy Link/ })
        .click();
      did('AL-084');
      await expect(notice(page, 'Link copied to clipboard')).toBeVisible();
      await expect
        .poll(() => clipboard(page))
        .toBe(`${mailbox.front.origin}/app/mail/${agenda.id}`);
      saw('STL-604');

      // The link is one that opens the thread.
      await page.goto(await clipboard(page));
      await expect(page.getByText('About Agenda.')).toBeVisible();
    });

    // When this fails, the copy-link shortcut does nothing for the row under
    // the cursor, or copies the link of another row.
    test('the copy-link shortcut copies the link of the row under the cursor', async ({
      page,
      mailbox,
    }) => {
      const { agenda, minutes } = await twoThreads(mailbox);

      await mailbox.open();
      await page.evaluate(() => navigator.clipboard.writeText('nothing yet'));
      await focusRow(page, agenda.id);
      await page.keyboard.press('ControlOrMeta+Shift+c');
      did('AL-072');
      await expect(notice(page, 'Link copied to clipboard')).toBeVisible();
      saw('STL-052');
      await expect
        .poll(() => clipboard(page))
        .toBe(`${mailbox.front.origin}/app/mail/${agenda.id}`);
      expect(await clipboard(page)).not.toContain(minutes.id);
    });

    // When this fails, Copy ID in a row's menu copies nothing or something
    // other than the thread's ID, or says nothing about it.
    test("Copy ID in the row menu puts the thread's ID on the clipboard", async ({
      page,
      mailbox,
    }) => {
      const { agenda, minutes } = await twoThreads(mailbox);

      await mailbox.open();
      await expect
        .poll(() => rowIds(page))
        .toEqual(expect.arrayContaining([agenda.id, minutes.id]));
      await page.evaluate(() => navigator.clipboard.writeText('nothing yet'));
      await row(page, minutes.id).click({ button: 'right' });
      await page
        .getByRole('menu')
        .getByRole('menuitem', { name: 'Copy ID' })
        .click();
      did('AL-603');
      await expect(notice(page, 'ID copied to clipboard')).toBeVisible();
      await expect.poll(() => clipboard(page)).toBe(minutes.id);
      saw('STL-948');
    });
  });

  test.describe(`copying the subject of a thread of ${anInbox(provider)} on a phone`, () => {
    test.use({ ...phone, provider });
    test.beforeEach(async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await loadAppSteadily(page);
    });

    // When this fails, the button after an open thread's subject copies
    // nothing or something other than the subject, or stays silent when the
    // clipboard refuses.
    test('Copy subject puts the subject on the clipboard, and says so when it cannot', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Agenda for the offsite',
        text: 'About the offsite.',
      });
      await mailbox.synced('Agenda for the offsite');

      await mailbox.open();
      expect(await page.evaluate(() => window.innerWidth)).toBe(
        phone.viewport.width
      );
      await page
        .getByRole('grid', { name: 'Email' })
        .getByText('Agenda for the offsite', { exact: true })
        .tap();
      await expect(page.getByText('About the offsite.')).toBeVisible();
      await page.evaluate(() => navigator.clipboard.writeText('nothing yet'));
      const copy = page.getByRole('button', { name: 'Copy subject' });
      await copy.tap();
      did('AL-501');
      await expect.poll(() => clipboard(page)).toBe('Agenda for the offsite');
      saw('STL-978');
      await expect(notice(page, 'Unable to copy subject')).toHaveCount(0);

      // A clipboard that refuses the write.
      await page.evaluate(() => {
        navigator.clipboard.writeText = () =>
          Promise.reject(new Error('refused'));
      });
      await copy.tap();
      await expect(notice(page, 'Unable to copy subject')).toBeVisible();
      saw('STL-503');
    });
  });
}

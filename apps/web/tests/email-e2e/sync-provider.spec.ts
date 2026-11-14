// What the app shows after something happened at the provider, outside
// Macro: mail that was there before the inbox was connected, mail that
// arrives, changes and deletions made in the provider's own client, mail
// sent from there, conversations, and the provider's own sorting of mail
// into Signal and Noise. Each for a Gmail and an Outlook inbox.
//
// Nothing is pushed to the page: the test waits until the email service
// holds the change, then loads the view.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { syncedInView } from './harness/journeys';
import { deliverNoise, rowIds } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import {
  changeAtProvider,
  deleteAtProvider,
  deliverAt,
  sendAtProvider,
} from './harness/sync';
import { threadMessages } from './harness/thread';
import { confirmed, saw } from './ledger/record';

const from = 'Grace <grace@example.com>';

type Preview = {
  id: string;
  name: string;
  isRead: boolean;
  inboxVisible: boolean;
};

/** A view of the mailbox (`inbox`, `all`, `sent`, `trash`, `other`) as the email service lists it. */
async function listed(
  mailbox: Mailbox,
  view: string,
  linkId = mailbox.inbox.linkId
): Promise<Preview[]> {
  const response = await mailbox.api(
    `/email/email/threads/previews/cursor/${view}?limit=100`,
    { headers: { 'x-email-link-id': linkId } }
  );
  const page = (await response.json()) as { items?: Preview[] };
  return page.items ?? [];
}

/** The subjects of the threads the email service lists in a view, sorted. */
async function subjects(mailbox: Mailbox, view: string): Promise<string[]> {
  return (await listed(mailbox, view)).map((thread) => thread.name).sort();
}

/** The row of a thread in the list. */
function row(page: Page, threadId: string) {
  return page.locator(`[data-soup-entity] [data-entity-id="${threadId}"]`);
}

/** The mark a row carries while its thread is unread. */
function unreadMark(page: Page, threadId: string) {
  return row(page, threadId).getByRole('img', { name: 'Unread' });
}

/** The messages of the open thread, top to bottom. */
function messages(page: Page) {
  return page.locator('[data-message-body-id]');
}

/** A conversation of three messages, minutes apart, oldest first. */
async function deliverConversation(
  mailbox: Mailbox,
  subject: string,
  bodies: [string, string, string]
): Promise<string[]> {
  const key = subject.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const start = Date.now() - 60 * 60_000;
  const ids: string[] = [];
  for (const [index, text] of bodies.entries()) {
    ids.push(
      await deliverAt(mailbox, {
        from,
        subject: index === 0 ? subject : `Re: ${subject}`,
        text,
        date: new Date(start + index * 10 * 60_000),
        messageId: `${key}-${index + 1}@example.com`,
        inReplyTo: index === 0 ? undefined : `${key}-${index}@example.com`,
      })
    );
  }
  return ids;
}

for (const provider of PROVIDERS) {
  test.describe(`what happened at the provider, for ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, connecting an inbox does not bring in the mail it
    // already held: the service does not list it, or the list does not show
    // it.
    test('mail the mailbox held before it was connected is listed', async ({
      page,
      mailbox,
    }) => {
      const held = ['Minutes of May', 'Minutes of June', 'Minutes of July'];
      await mailbox.stack.seed(
        provider,
        'archive@example.com',
        held.map((subject) => ({
          from,
          subject,
          text: `${subject}, attached.`,
        }))
      );
      const archive = await mailbox.stack.link(
        mailbox.user,
        provider,
        'archive@example.com'
      );

      let imported: Preview[] = [];
      await expect
        .poll(
          async () => {
            imported = await listed(mailbox, 'inbox', archive.linkId);
            return imported.map((thread) => thread.name).sort();
          },
          { timeout: 60_000 }
        )
        .toEqual([...held].sort());
      confirmed('F-016');

      await mailbox.open();
      const list = page.getByRole('grid', { name: 'Email' });
      for (const thread of imported) {
        await expect(row(page, thread.id)).toContainText(thread.name);
      }
      await expect(list.getByText('Minutes of June, attached.')).toBeVisible();
      saw('STL-984');
    });

    // When this fails, mail that arrives at the provider does not reach the
    // app: the service never lists it, or the list has no row for it.
    test('mail that arrives at the provider is a row in the list', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Lunch?', text: 'Noon?' });
      const lunch = await mailbox.synced('Lunch?');
      await mailbox.open();
      await expect.poll(() => rowIds(page)).toEqual([lunch.id]);

      // A second message arrives while the app is closed on another view.
      await mailbox.deliver({
        from: 'Linus <linus@example.com>',
        subject: 'Budget',
        text: 'The numbers are in.',
      });
      const budget = await mailbox.synced('Budget');
      expect(await subjects(mailbox, 'inbox')).toEqual(['Budget', 'Lunch?']);
      const held = await threadMessages(mailbox, budget.id);
      expect(held.map((message) => message.body_text?.trim())).toEqual([
        'The numbers are in.',
      ]);
      confirmed('F-017');

      await mailbox.open();
      await expect.poll(() => rowIds(page)).toEqual([budget.id, lunch.id]);
      await expect(row(page, budget.id)).toContainText('Linus');
      await expect(row(page, budget.id)).toContainText('Budget');
      await expect(row(page, budget.id)).toContainText('The numbers are in.');
      await expect(unreadMark(page, budget.id)).toHaveCount(1);
      saw('STL-973');
    });

    // When this fails, what the owner did to a thread in the provider's own
    // client does not reach the app: a thread read there is still unread
    // here, one archived or deleted there is still in the inbox.
    test("a thread read, archived or trashed in the provider's own client shows so", async ({
      page,
      mailbox,
    }) => {
      const delivered = new Map<string, string>();
      for (const subject of ['Read there', 'Archived there', 'Trashed there']) {
        const message = await mailbox.deliver({
          from,
          subject,
          text: `Body of ${subject}.`,
        });
        delivered.set(subject, message.id);
      }
      await mailbox.deliver({ from, subject: 'Untouched', text: 'As it was.' });
      const read = await mailbox.synced('Read there');
      const archived = await mailbox.synced('Archived there');
      const trashed = await mailbox.synced('Trashed there');
      const untouched = await mailbox.synced('Untouched');
      // Before: all four in the inbox, unread.
      expect(
        (await listed(mailbox, 'inbox')).map((thread) => thread.isRead)
      ).toEqual([false, false, false, false]);

      const id = (subject: string) => delivered.get(subject) ?? '';
      await changeAtProvider(mailbox, id('Read there'), { read: true });
      await changeAtProvider(mailbox, id('Archived there'), { archived: true });
      await changeAtProvider(mailbox, id('Trashed there'), { trashed: true });

      await expect
        .poll(
          async () => {
            const inbox = await listed(mailbox, 'inbox');
            const all = await listed(mailbox, 'all');
            return {
              inbox: inbox.map((thread) => thread.name).sort(),
              unread: inbox
                .filter((thread) => !thread.isRead)
                .map((thread) => thread.name),
              archived: all
                .filter((thread) => !thread.inboxVisible)
                .map((thread) => thread.name),
              trash: await subjects(mailbox, 'trash'),
            };
          },
          { timeout: 60_000 }
        )
        .toEqual({
          inbox: ['Read there', 'Untouched'],
          unread: ['Untouched'],
          archived: ['Archived there'],
          trash: ['Trashed there'],
        });
      confirmed('F-019');

      await mailbox.open();
      await expect
        .poll(async () => (await rowIds(page)).toSorted())
        .toEqual([read.id, untouched.id].toSorted());
      await expect(unreadMark(page, untouched.id)).toHaveCount(1);
      await expect(unreadMark(page, read.id)).toHaveCount(0);
      const library = page.getByRole('navigation', { name: 'Email library' });
      await library.getByRole('button', { name: 'Archived' }).click();
      await expect(page).toHaveURL(/tab=archived/);
      await expect.poll(() => rowIds(page)).toEqual([archived.id]);
      await library.getByRole('button', { name: 'Trash' }).click();
      await expect(page).toHaveURL(/tab=trash/);
      await expect.poll(() => rowIds(page)).toEqual([trashed.id]);
      saw('STL-901');
    });

    // When this fails, a message deleted for good at the provider stays in
    // its thread in the app.
    //
    // Known bug on Outlook: the service asks Outlook for the deleted message
    // three times over a minute and a half, then marks it missing, and the
    // thread goes on showing it.
    test(`${provider === 'OUTLOOK' ? 'known bug: outlook-deleted-message-stays-in-thread: ' : ''}a message deleted at the provider is gone from its thread`, {
      tag: provider === 'OUTLOOK' ? '@known-bug' : [],
    }, async ({ page, mailbox }) => {
      // Outlook's deletion is believed only on the third look, 90 s later.
      if (provider === 'OUTLOOK') test.setTimeout(240_000);
      const [, second] = await deliverConversation(mailbox, 'Offsite', [
        'Where shall we go?',
        'Forget that: wrong list.',
        'The coast, I think.',
      ]);
      const thread = await mailbox.synced('Re: Offsite');
      const bodies = async () =>
        (await threadMessages(mailbox, thread.id)).map((message) =>
          message.body_text?.trim()
        );
      await expect
        .poll(bodies)
        .toEqual([
          'Where shall we go?',
          'Forget that: wrong list.',
          'The coast, I think.',
        ]);

      await deleteAtProvider(mailbox, second);
      await expect
        .poll(bodies, { timeout: provider === 'OUTLOOK' ? 150_000 : 60_000 })
        .toEqual(['Where shall we go?', 'The coast, I think.']);
      confirmed('F-020');

      await mailbox.open(`/app/mail/${thread.id}`);
      await expect(messages(page)).toHaveText([
        /Where shall we go\?/,
        /The coast, I think\./,
      ]);
      await expect(page.getByText('Forget that: wrong list.')).toHaveCount(0);
      saw('STL-902');
    });

    // When this fails, mail the owner sent from the provider's own client
    // is missing from Sent in the app.
    test("mail sent from the provider's own client is listed in Sent", async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Lunch?', text: 'Noon?' });
      await mailbox.synced('Lunch?');
      await sendAtProvider(mailbox, {
        to: 'linus@example.com',
        subject: 'From my phone',
        text: 'Running late.',
      });
      const sent = await syncedInView(mailbox, 'sent', 'From my phone');
      expect(await subjects(mailbox, 'sent')).toEqual(['From my phone']);
      expect(await subjects(mailbox, 'inbox')).toEqual(['Lunch?']);
      const [message] = await threadMessages(mailbox, sent);
      expect(message.is_sent).toBe(true);
      expect(message.body_text?.trim()).toBe('Running late.');
      confirmed('F-022');

      await mailbox.open();
      await page
        .getByRole('navigation', { name: 'Email tabs' })
        .getByRole('button', { name: 'Sent' })
        .click();
      await expect(page).toHaveURL(/tab=sent/);
      await expect.poll(() => rowIds(page)).toEqual([sent]);
      await expect(row(page, sent)).toContainText('From my phone');
      await expect(row(page, sent)).toContainText('Running late.');
      saw('STL-904');
    });

    // When this fails, the replies of a conversation are not put together:
    // each is a thread of its own, or the thread shows them out of order.
    test('the messages of a conversation are one thread, in order', async ({
      page,
      mailbox,
    }) => {
      const texts: [string, string, string] = [
        'Where shall we go?',
        'The coast, I think.',
        'The coast it is.',
      ];
      await deliverConversation(mailbox, 'Offsite', texts);
      await mailbox.deliver({ from, subject: 'Lunch?', text: 'Noon?' });
      const lunch = await mailbox.synced('Lunch?');
      const offsite = await mailbox.synced('Re: Offsite');

      let held = await threadMessages(mailbox, offsite.id);
      await expect
        .poll(async () => {
          held = await threadMessages(mailbox, offsite.id);
          return held.map((message) => message.body_text?.trim());
        })
        .toEqual(texts);
      expect(held.map((message) => message.replying_to_id)).toEqual([
        null,
        held[0].db_id,
        held[1].db_id,
      ]);
      expect(await subjects(mailbox, 'inbox')).toEqual([
        'Lunch?',
        'Re: Offsite',
      ]);
      confirmed('F-025');

      await mailbox.open();
      await expect
        .poll(async () => (await rowIds(page)).toSorted())
        .toEqual([lunch.id, offsite.id].toSorted());
      await row(page, offsite.id).click();
      await expect(page).toHaveURL(new RegExp(`/app/mail/${offsite.id}`));
      await expect(messages(page)).toHaveText([
        /Where shall we go\?/,
        /The coast, I think\./,
        /The coast it is\./,
      ]);
      saw('STL-905');
    });

    // When this fails, the provider's own sorting of mail is lost: what it
    // set aside (Gmail's Promotions, Outlook's Other) is listed with the
    // important mail under Signal, or important mail is listed under Noise.
    test('mail the provider set aside is Noise, the rest Signal', async ({
      page,
      mailbox,
    }) => {
      await deliverNoise(mailbox, {
        from: 'Deals <deals@example.com>',
        subject: 'Sale',
        text: 'Everything must go.',
      });
      await mailbox.deliver({ from, subject: 'Lunch?', text: 'Noon?' });
      const lunch = await mailbox.synced('Lunch?');
      const sale = await mailbox.synced('Sale');
      // The service keeps both in the inbox and lists only the one set
      // aside under `other`, which is what the Noise tab reads.
      expect(await subjects(mailbox, 'inbox')).toEqual(['Lunch?', 'Sale']);
      expect(await subjects(mailbox, 'other')).toEqual(['Sale']);
      confirmed('F-027');

      const tabs = page.getByRole('radiogroup', { name: 'Inbox view' });
      await mailbox.open();
      await expect(tabs.getByRole('radio', { name: 'Signal' })).toBeChecked();
      await expect.poll(() => rowIds(page)).toEqual([lunch.id]);
      await tabs.getByText('Noise', { exact: true }).click();
      await expect(tabs.getByRole('radio', { name: 'Noise' })).toBeChecked();
      await expect.poll(() => rowIds(page)).toEqual([sale.id]);
      saw('STL-985');
    });
  });
}

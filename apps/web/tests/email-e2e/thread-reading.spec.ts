// Reading a thread: the quoted text and signature a reply hides, moving
// between its messages with the keyboard, who a message is from and to, and
// the thread's details in the side panel. For a Gmail and an Outlook inbox.

import type { Locator, Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { anInbox, PROVIDERS } from './harness/providers';
import { deliverThread, messageCard, threadMessages } from './harness/thread';
import { did, saw } from './ledger/record';

/** A reply as a mail client writes it: the answer, a signature, the quote. */
const REPLY =
  '<div>Friday works for me.</div>' +
  '<div class="gmail_signature">Grace Hopper, Rear Admiral</div>' +
  '<div class="gmail_quote"><div class="gmail_attr">On Mon, Oct 26, 2026 at 9:15 AM Ada wrote:</div>' +
  '<blockquote>Shall we launch on Friday?</blockquote></div>';

const THREE = [1, 2, 3].map((point) => ({
  text: `Point number ${point} of the plan.`,
}));

/** Everyone on the committee's message but the sender and the viewer. */
const COMMITTEE = [
  'Alan Turing <alan@example.com>',
  'Edsger Dijkstra <edsger@example.com>',
  'Barbara Liskov <barbara@example.com>',
  'Donald Knuth <donald@example.com>',
  'Frances Allen <frances@example.com>',
  'John Backus <john@example.com>',
];

/**
 * Which of the thread's messages are open, top to bottom: an open message
 * shows its recipients line, a collapsed row does not.
 */
async function openMessages(cards: Locator): Promise<boolean[]> {
  const open: boolean[] = [];
  for (const card of await cards.all()) {
    open.push((await card.getByText('to Me').count()) > 0);
  }
  return open;
}

/** The people under the subject, as their badges name them. */
function participants(page: Page): Locator {
  return page
    .getByRole('main')
    .getByRole('list')
    .filter({ has: page.getByRole('link', { name: 'Grace' }) })
    .getByRole('link');
}

for (const provider of PROVIDERS) {
  test.describe(`reading a thread in ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a reply shows the whole conversation quoted under it
    // and its sender's signature, has no button to show what was trimmed, or
    // the button does not bring the quote and the signature back.
    test('a reply hides its quote and signature until they are asked for', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Launch date',
        text: 'Shall we launch on Friday?',
        messageId: 'launch-date-1@example.com',
      });
      // A thread orders its messages by their date, which Outlook keeps to
      // the second: the reply arrives in a later second than the question.
      const asked = Math.floor(Date.now() / 1000);
      await expect
        .poll(() => Math.floor(Date.now() / 1000), { intervals: [100] })
        .toBeGreaterThan(asked);
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Re: Launch date',
        html: REPLY,
        messageId: 'launch-date-2@example.com',
        inReplyTo: 'launch-date-1@example.com',
      });
      const thread = await mailbox.synced('Re: Launch date');
      await expect
        .poll(async () => (await threadMessages(mailbox, thread.id)).length)
        .toBe(2);
      await mailbox.open(`/app/mail/${thread.id}`);
      did('AL-910');
      const reply = messageCard(page, 'Friday works for me.');
      await expect(reply).toBeVisible();
      await expect(reply.getByText('Ada wrote:')).toHaveCount(0);
      await expect(reply.getByText('Rear Admiral')).toHaveCount(0);
      const showQuoted = reply.getByRole('button', {
        name: 'Show quoted text',
      });
      await expect(showQuoted).toBeVisible();
      saw('STL-090');

      await showQuoted.click();
      did('AL-167');
      await expect(reply.getByText('Ada wrote:')).toBeVisible();
      await expect(reply.getByText('Shall we launch on Friday?')).toBeVisible();
      await expect(reply.getByText('Grace Hopper, Rear Admiral')).toBeVisible();
      await expect(showQuoted).toHaveCount(0);
    });

    // When this fails, the arrow keys do not move the selection
    // from one message of a thread to the next, or an empty reply does not
    // give the keyboard back to the messages: `o` then opens or closes a
    // different message from the one the keys went to.
    test('the keyboard moves from the reply up through the messages and back', async ({
      page,
      mailbox,
    }) => {
      const thread = await deliverThread(mailbox, 'Offsite plan', THREE);
      await mailbox.open(`/app/mail/${thread.id}`);
      did('AL-910');
      const cards = messageCard(page, 'Point number');
      // Unread, so all three are open.
      await expect.poll(() => openMessages(cards)).toEqual([true, true, true]);

      // From the empty reply up to the last message: `o` closes that one.
      await page.getByText('Reply...').click();
      did('AL-171');
      // The pointer would otherwise lead the keys from where it clicked.
      await page.mouse.move(0, 0);
      await expect(page.getByRole('textbox', { name: /^Reply/ })).toBeFocused();
      await page.keyboard.press('ArrowUp');
      did('AC-095');
      await page.keyboard.press('o');
      did('AL-142');
      await expect.poll(() => openMessages(cards)).toEqual([true, true, false]);
      saw('STL-928');

      // Up to the message before it.
      await page.keyboard.press('ArrowUp');
      did('AL-141');
      await page.keyboard.press('o');
      await expect
        .poll(() => openMessages(cards))
        .toEqual([true, false, false]);
      saw('STL-928');

      // And down again to the last one, which `o` opens.
      await page.keyboard.press('ArrowDown');
      did('AL-141');
      await page.keyboard.press('o');
      await expect.poll(() => openMessages(cards)).toEqual([true, false, true]);
      saw('STL-928');
    });

    // When this fails, a message does not say who sent it and to whom, a
    // name shows no card with the person's full name and address, or the
    // people of a thread are not listed under its subject (the first five,
    // the rest behind "+N more").
    test('a message names its sender and recipients, and the thread its people', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: 'Grace Hopper <grace@example.com>',
        to: [mailbox.inbox.email, ...COMMITTEE.slice(0, 2)].join(', '),
        cc: COMMITTEE.slice(2).join(', '),
        subject: 'Committee',
        text: 'The committee meets on Tuesday.',
      });
      const thread = await mailbox.synced('Committee');
      await mailbox.open(`/app/mail/${thread.id}`);
      did('AL-910');
      const card = messageCard(page, 'The committee meets on Tuesday.');
      await expect(card).toBeVisible();

      // The header: the sender, "to" everyone it went to, and its date.
      await expect(
        card.getByRole('link', { name: 'Grace', exact: true })
      ).toBeVisible();
      for (const name of [
        'Me',
        'Alan',
        'Edsger',
        'Barbara',
        'Donald',
        'Frances',
        'John',
      ]) {
        await expect(
          card.getByRole('link', { name, exact: true })
        ).toBeVisible();
      }
      // Seven recipients: five commas, then "&" before the last.
      await expect(card).toContainText(
        /Grace\s*to\s*(?:[A-Z][a-z]+\s*,\s*){5}[A-Z][a-z]+\s*&\s*[A-Z][a-z]+/
      );
      await expect(card).toContainText(/[A-Z][a-z]{2} \d{1,2}/);
      saw('STL-500');

      // The sender's card: the full name and the address, which the header
      // does not show.
      await expect(page.getByText('grace@example.com')).toHaveCount(0);
      await card.getByRole('link', { name: 'Grace', exact: true }).hover();
      did('AL-100');
      await expect(page.getByText('Grace Hopper')).toBeVisible();
      await expect(page.getByText('grace@example.com')).toBeVisible();
      await page.mouse.move(0, 0);
      await expect(page.getByText('grace@example.com')).toHaveCount(0);

      // Under the subject: five of the eight people, then the rest.
      const people = participants(page);
      const more = page.getByRole('button', { name: '+3 more' });
      await expect(people).toHaveCount(5);
      await expect(people.filter({ hasText: 'Grace' })).toHaveCount(1);
      await expect(more).toBeVisible();
      saw('STL-091');
      await more.click();
      did('AL-163');
      await expect(people).toHaveCount(8);
      for (const name of [
        'Grace',
        'Me',
        'Alan',
        'Edsger',
        'Barbara',
        'Donald',
        'Frances',
        'John',
      ]) {
        await expect(people.filter({ hasText: name })).toHaveCount(1);
      }
      await page.getByRole('button', { name: 'Show less' }).click();
      did('AL-163');
      await expect(people).toHaveCount(5);
      await expect(more).toBeVisible();
    });

    // When this fails, the Details button of a thread does not open the side
    // panel, the panel lacks the thread's sections or its dates, or the
    // button does not close it again.
    test('the side panel shows the details of the thread', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: 'Grace Hopper <grace@example.com>',
        subject: 'Committee',
        text: 'The committee meets on Tuesday.',
      });
      const thread = await mailbox.synced('Committee');
      await mailbox.open(`/app/mail/${thread.id}`);
      did('AL-910');
      await expect(
        messageCard(page, 'The committee meets on Tuesday.')
      ).toBeVisible();
      const panel = page.getByRole('complementary', { name: 'Block details' });
      await expect(panel).toHaveCount(0);

      await page.getByRole('button', { name: 'Show details' }).click();
      did('AL-132');
      await expect(panel).toBeVisible();
      const dates = panel.getByRole('region', { name: 'Details' });
      await expect(dates).toContainText(/Created\s*\d{1,2}:\d{2}/);
      await expect(dates).toContainText(/Last updated\s*\d{1,2}:\d{2}/);
      await expect(
        panel.getByRole('button', { name: 'Tags', exact: true })
      ).toBeVisible();
      await expect(
        panel.getByRole('button', { name: 'Properties', exact: true })
      ).toBeVisible();
      const activity = panel.getByRole('button', {
        name: 'Activity',
        exact: true,
      });
      await expect(activity).toBeVisible();
      // Nothing has been done to the thread yet.
      await activity.click();
      await expect(panel.getByRole('region', { name: 'Activity' })).toHaveText(
        'No activity yet'
      );
      saw('STL-980');

      await page.getByRole('button', { name: 'Hide details' }).click();
      did('AL-132');
      await expect(panel).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Show details' })
      ).toBeVisible();
    });
  });
}

// The open thread's keys and header controls that only change what is on
// screen: Enter and f for a reply all and a forward, Back, Enter on a
// collapsed message and on the hidden-messages chip, Shift+O, the header
// caret of a message, and the older messages a long thread loads when its
// list is scrolled to the top.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { anInbox, PROVIDERS } from './harness/providers';
import { deliverThread, messageCard } from './harness/thread';
import {
  allRead,
  deliverEach,
  openFromList,
  openMessages,
  row,
} from './harness/ways-thread';
import { threadReadsInFlight } from './harness/ways-thread-more';
import { did } from './ledger/record';

const XAVIER = 'Xavier <xavier@example.com>';

const points = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    text: `Point number ${index + 1} of the plan.`,
  }));

const longPoints = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    text: [
      `Point number ${index + 1} of the plan.`,
      ...Array.from({ length: 60 }, (_, line) => `Detail ${line + 1}.`),
    ].join('\n\n'),
  }));

// What these keys and buttons do does not depend on the mailbox: they open a
// composer, move in the page, or show what Macro already holds. Gmail only.
test.describe('the keys and header of an open thread', () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, Enter in an open thread opens no reply (or a reply to
  // the sender alone), f opens no forward, or the header's Back button does
  // not return to the list.
  test('Enter replies to all, f forwards, and Back returns to the list', async ({
    page,
    mailbox,
  }) => {
    for (const subject of ['Offsite', 'Venue']) {
      await mailbox.deliver({
        from: XAVIER,
        to: mailbox.inbox.email,
        cc: 'Yara <yara@example.com>',
        subject,
        text: `About ${subject}.`,
      });
    }
    const offsite = await mailbox.synced('Offsite');
    const venue = await mailbox.synced('Venue');
    await mailbox.open();

    // No message is focused: Enter answers the latest one, to everyone.
    await openFromList(page, offsite.id, 'About Offsite.');
    await page.keyboard.press('Enter');
    did('AL-134');
    await expect(
      page.getByRole('button', { name: 'Replying to Xavier + 1', exact: true })
    ).toBeVisible();

    await page.getByRole('button', { name: 'Back', exact: true }).click();
    did('AL-122');
    await expect(page).toHaveURL(/\/app\/mail$/);
    await expect(row(page, venue.id)).toBeVisible();

    await openFromList(page, venue.id, 'About Venue.');
    await page.keyboard.press('f');
    did('AL-135');
    await expect(
      page.getByRole('textbox', { name: /^Forward — / })
    ).toBeVisible();
  });

  // When this fails, Enter on a collapsed message does not open it, Enter
  // on the hidden-messages chip does not show the messages behind it, or
  // Shift+O leaves messages collapsed or hidden.
  test('Enter opens the focused collapsed message and the hidden messages, Shift+O opens every message', async ({
    page,
    mailbox,
  }) => {
    const first = await deliverThread(mailbox, 'Offsite plan', points(5));
    const second = await deliverThread(mailbox, 'Budget plan', points(5));
    await mailbox.open();
    const cards = messageCard(page, 'Point number');
    const chip = page.getByRole('button', { name: 'Show 2 hidden messages' });
    const back = page.getByRole('button', { name: 'Back', exact: true });

    // A thread read before shows its first, fourth and last message, the
    // last one open, and the two between behind the chip.
    const revisit = async (threadId: string) => {
      await openFromList(page, threadId, 'Point number 5');
      await allRead(mailbox, threadId);
      await back.click();
      await expect(page).toHaveURL(/\/app\/mail$/);
      await row(page, threadId).click();
      await expect(chip).toBeVisible();
      await expect
        .poll(() => openMessages(cards))
        .toEqual([false, false, true]);
    };

    await revisit(first.id);
    // With nothing selected and the pointer off the list, Up selects the
    // newest message, then the collapsed one before it. (Not from the reply
    // box: it takes focus back a moment after it opens.)
    await page.mouse.move(0, 0);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    did('AL-506');
    await expect.poll(() => openMessages(cards)).toEqual([false, true, true]);
    await expect(chip).toBeVisible();

    // Up once more is the chip.
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    did('AL-504');
    await expect(chip).toHaveCount(0);
    await expect(cards).toHaveCount(5);
    await back.click();
    await expect(page).toHaveURL(/\/app\/mail$/);

    await revisit(second.id);
    await page.keyboard.press('Shift+O');
    did('AL-143');
    await expect(chip).toHaveCount(0);
    await expect
      .poll(() => openMessages(cards))
      .toEqual([true, true, true, true, true]);
  });

  // When this fails, the caret beside a message's recipients does not show
  // (or hide) who the message is from and to in full.
  test("the header caret shows and hides a message's details", async ({
    page,
    mailbox,
  }) => {
    const ids = await deliverEach(mailbox, ['Agenda']);
    await mailbox.open();
    await openFromList(page, ids.Agenda, 'About Agenda.');
    const card = messageCard(page, 'About Agenda.');
    // The caret has no name of its own: it is the button beside the
    // recipients, named by the tooltip it shows.
    const caret = card
      .getByText('to Me')
      .locator('xpath=following-sibling::div[1]')
      .getByRole('button');
    await caret.hover();
    await expect(page.getByText('Expand Message Header')).toBeVisible();
    await caret.click();
    did('AL-165');
    await expect(card.getByText('From', { exact: true })).toBeVisible();
    await expect(card.getByText('grace@example.com').first()).toBeVisible();

    await page.mouse.move(0, 0);
    await caret.hover();
    await expect(page.getByText('Collapse Message Header')).toBeVisible();
    await caret.click();
    did('AL-165');
    await expect(card.getByText('From', { exact: true })).toHaveCount(0);
  });
});

for (const provider of PROVIDERS) {
  test.describe(`a long thread in ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a thread of more messages than one page shows only
    // its latest twenty: scrolling to the top never loads the older ones.
    test('scrolling to the top of a long thread loads its older messages', async ({
      page,
      mailbox,
    }) => {
      // One message more than a page, each long enough that the list
      // overflows (a list that does not overflow loads the older page by
      // itself), and a second apart so the thread's order is their order.
      const thread = await deliverThread(mailbox, 'Long plan', longPoints(21), {
        aSecondApart: true,
      });
      const reads = threadReadsInFlight(page);
      await mailbox.open();
      // Read once, so that it opens again at its latest message.
      await openFromList(page, thread.id, 'Point number 21 of the plan.');
      await allRead(mailbox, thread.id);
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(page).toHaveURL(/\/app\/mail$/);
      await row(page, thread.id).click();
      // One page is the latest twenty: the oldest of them, the chip for the
      // seventeen after it, and the last two.
      const cards = messageCard(page, 'Point number');
      await expect(
        page.getByRole('button', { name: 'Show 17 hidden messages' })
      ).toBeVisible();
      await expect(cards.first()).toContainText('Point number 2 of the plan.');

      // A scroll made while the thread still reads its messages is dropped.
      await expect.poll(reads).toBe(0);
      await cards.last().hover();
      await page.mouse.wheel(0, -200_000);
      did('AL-502');
      await expect(
        page.getByRole('button', { name: 'Show 18 hidden messages' })
      ).toBeVisible();
      await expect(cards.first()).toContainText('Point number 1 of the plan.');
    });
  });
}

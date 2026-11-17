// The messages of a thread that was read before: the middle of a long thread
// hidden behind a chip, and a message opened and closed again. For a Gmail
// and an Outlook inbox.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { anInbox, PROVIDERS } from './harness/providers';
import { deliverThread, messageCard, threadMessages } from './harness/thread';
import { did, saw } from './ledger/record';

const FIVE = [1, 2, 3, 4, 5].map((point) => ({
  text: `Point number ${point} of the plan.`,
}));

for (const provider of PROVIDERS) {
  test.describe(`the messages of a read thread in ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a long thread read before shows every message again
    // (no chip), the chip does not bring the hidden messages back, or a
    // message cannot be opened from its collapsed row or closed from its
    // header.
    test('the chip shows the hidden middle messages, and a message opens and closes', async ({
      page,
      mailbox,
    }) => {
      const thread = await deliverThread(mailbox, 'Offsite plan', FIVE);
      await mailbox.open('/app/mail');
      // Which message a provider counts as the latest of five that arrive
      // together differs, so the steps go by what the thread shows.
      const row = page.locator(
        `[data-soup-entity] [data-entity-id="${thread.id}"]`
      );
      const cards = messageCard(page, 'Point number');
      await row.click();
      did('AL-050');
      await page.getByText('Reply...').waitFor();
      // Unread messages are open; read ones collapse on the next visit.
      await expect
        .poll(async () =>
          (await threadMessages(mailbox, thread.id)).every(
            (message) => message.is_read
          )
        )
        .toBe(true);
      // The next visit is made inside the app: a reload can cut off the
      // request that marked the thread seen.
      await page.keyboard.press('Escape');
      did('AL-123');
      await expect(page).toHaveURL(/\/app\/mail$/);
      await row.click();
      await page.getByText('Reply...').waitFor();

      // The first, the one before the last and the last are there, the last
      // one open; the two between are behind the chip.
      const chip = page.getByRole('button', { name: 'Show 2 hidden messages' });
      await expect(chip).toBeVisible();
      await expect(cards).toHaveCount(3);
      await expect(cards.getByText('to Me')).toHaveCount(1);
      saw('STL-069');
      await chip.click();
      did('AL-166');
      await expect(chip).toHaveCount(0);
      await expect(cards).toHaveCount(5);
      await expect(cards.getByText('to Me')).toHaveCount(1);

      // A read message is a collapsed row: its snippet, no recipients line.
      const collapsed = cards.filter({ hasNotText: 'to Me' }).nth(1);
      const text = /Point number \d of the plan\./.exec(
        await collapsed.innerText()
      )?.[0];
      expect(text).toBeDefined();
      const message = messageCard(page, text ?? '');
      await expect(message.getByText('to Me')).toHaveCount(0);
      await expect(message.getByText(text ?? '')).toBeVisible();
      saw('STL-501');
      await message.click();
      did('AL-505');
      await expect(message.getByText('to Me')).toBeVisible();
      await expect(
        message.getByRole('button', { name: 'Reply', exact: true })
      ).toBeVisible();
      await expect(cards.getByText('to Me')).toHaveCount(2);
      await message.getByText('to Me').click();
      did('AL-164');
      await expect(message.getByText('to Me')).toHaveCount(0);
      await expect(
        message.getByRole('button', { name: 'Reply', exact: true })
      ).toHaveCount(0);
      await expect(message.getByText(text ?? '')).toBeVisible();
      saw('STL-501');
    });
  });
}

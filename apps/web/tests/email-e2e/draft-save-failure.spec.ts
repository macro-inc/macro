import {
  draftThreads,
  graphqlOperation,
  loadAppSteadily,
} from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { confirmed, did } from './ledger/record';

test.beforeEach(({ page }) => loadAppSteadily(page));

test.describe('a draft save the server fails', () => {
  // Class draft-save-failure-blocks-other-writes: when this fails, a draft
  // save that hit a passing server fault is given up at once and the user is
  // alarmed with "Draft could not be synced" while the text stays unsaved, or
  // the archive queued behind the save never reaches the server.
  test('is retried quietly while the thread is archived', async ({
    page,
    mailbox,
  }) => {
    await mailbox.deliver({
      from: 'Grace <grace@example.com>',
      subject: 'Invoice',
      text: 'Due Friday.',
    });
    const thread = await mailbox.synced('Invoice');
    let faults = 0;
    await page.route(/\/graphql$/, async (route) => {
      if (graphqlOperation(route.request()) !== 'SaveEmailDraft' || faults >= 2)
        return route.fallback();
      faults += 1;
      await route.fulfill({
        json: {
          data: null,
          errors: [
            { message: 'internal error', extensions: { code: 'INTERNAL' } },
          ],
        },
      });
    });

    await mailbox.open(`/app/mail/${thread.id}`);
    did('AL-910');
    await page.getByText('Reply...').click();
    did('AL-171');
    await page.keyboard.type('Paid today.');
    did('AC-081');
    did('AC-911');
    await expect.poll(() => faults).toBeGreaterThan(0);
    await page.getByText('Due Friday.').click();
    await page.keyboard.press('e');
    did('AL-137');

    await expect
      .poll(async () =>
        (await mailbox.providerMessages()).map((message) => message.inInbox)
      )
      .toEqual([false]);
    confirmed('F-071');
    // The save went through on its third attempt.
    await expect
      .poll(async () => (await draftThreads(mailbox)).map((draft) => draft.id))
      .toEqual([thread.id]);
    expect(faults).toBe(2);
    await expect(page.getByText('Draft could not be synced')).toHaveCount(0);
  });
});

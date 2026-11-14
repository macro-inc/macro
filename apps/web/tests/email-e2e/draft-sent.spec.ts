import {
  draftThreads,
  graphqlOperation,
  loadAppSteadily,
} from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { sentMessages } from './harness/send';
import { confirmed, did, saw } from './ledger/record';

test.beforeEach(({ page }) => loadAppSteadily(page));

test.describe('a draft that was sent', () => {
  // Class sent-draft-copied-into-new-draft: when this fails, the composer
  // takes the text of the reply it just sent for unsaved edits and keeps it as
  // a new draft: the sent message is listed under Drafts as well.
  test('is not kept as a new draft when it is sent before its last save settles', async ({
    page,
    mailbox,
  }) => {
    await mailbox.deliver({
      from: 'Grace <grace@example.com>',
      subject: 'Lunch?',
      text: 'Noon at the usual place?',
    });
    const thread = await mailbox.synced('Lunch?');

    // Once switched on, every save of the draft meets a server fault, so the
    // text typed from then on is in no save the server took.
    let failing = false;
    let faults = 0;
    await page.route(/\/graphql$/, async (route) => {
      if (!failing || graphqlOperation(route.request()) !== 'SaveEmailDraft')
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
    await page.keyboard.type('Works for me.');
    did('AC-081');
    did('AC-911');
    await expect.poll(async () => (await draftThreads(mailbox)).length).toBe(1);
    failing = true;
    await page.keyboard.type(' See you at noon.');
    await expect.poll(() => faults).toBeGreaterThan(0);
    await page.keyboard.press('ControlOrMeta+Enter');
    did('AC-311');

    await expect
      .poll(async () => (await sentMessages(mailbox)).length, {
        timeout: 30_000,
      })
      .toBe(1);
    confirmed('F-132');
    // The sent reply shows in the thread, and the composer is empty again.
    await expect(page.getByText('See you at noon.')).toBeVisible();
    saw('STC-957');
    await expect(page.getByText('Reply...')).toBeVisible();
    saw('STL-106');
    failing = false;
    await expect(page.getByText(/kept as a new draft/)).toHaveCount(0);
    await expect.poll(() => draftThreads(mailbox)).toEqual([]);
    await page.reload();
    await expect(page.getByText('Reply...')).toBeVisible();
    expect(await draftThreads(mailbox)).toEqual([]);
  });
});

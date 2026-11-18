import { discardButton, draftThreads, loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { did, saw } from './ledger/record';

test.beforeEach(({ page }) => loadAppSteadily(page));

test.describe('discarding a reply draft', () => {
  test.beforeEach(async ({ page, mailbox }) => {
    await mailbox.deliver({
      from: 'Grace <grace@example.com>',
      subject: 'Lunch?',
      html: '<p>Noon at the usual place?</p>',
    });
    const thread = await mailbox.synced('Lunch?');
    await mailbox.open(`/app/mail/${thread.id}`);
    did('AL-910');
    await page.getByText('Reply...').click();
    did('AL-171');
    await page.keyboard.type('Works for me.');
    did('AC-081');
    did('AC-911');
    await expect.poll(async () => (await draftThreads(mailbox)).length).toBe(1);
  });

  // Class draft-discard-save-race: when this fails, the save of the last
  // keystroke lands after the discard and brings the draft back: it is listed
  // under Drafts again and the thread reopens with the discarded reply.
  test('a keystroke right before the discard does not bring the draft back', async ({
    page,
    mailbox,
  }) => {
    await page.keyboard.type('x');
    await discardButton(page).click();
    did('AC-093');

    await expect(page.getByText('Reply...')).toBeVisible();
    saw('STL-106');
    await expect.poll(() => draftThreads(mailbox)).toEqual([]);
    // A reload replays whatever the page still had queued.
    await page.reload();
    await expect(page.getByText('Reply...')).toBeVisible();
    await expect(page.getByText('Works for me.')).toHaveCount(0);
    expect(await draftThreads(mailbox)).toEqual([]);
  });

  // Class draft-discard-save-race: when this fails, a reply whose text was
  // deleted is saved again as an empty draft instead of being removed.
  test('emptying the reply removes its draft', async ({ page, mailbox }) => {
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');

    await expect.poll(() => draftThreads(mailbox)).toEqual([]);
    await page.reload();
    await expect(page.getByText('Reply...')).toBeVisible();
    saw('STL-106');
    expect(await draftThreads(mailbox)).toEqual([]);
  });
});

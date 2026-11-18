import { expect, test } from './harness/fixtures';
import { deliverThread, messageCard, threadMessages } from './harness/thread';
import { did, saw } from './ledger/record';

const FIVE = [1, 2, 3, 4, 5].map((point) => ({
  text: `Point number ${point} of the plan.`,
}));

test.describe('the thread view', () => {
  // Class web-thread-view: a draft reply left on an earlier message keeps that
  // message open. When this fails the message is a collapsed row and the
  // draft cannot be seen or found again.
  test('a message with a draft reply stays open with the draft', async ({
    page,
    mailbox,
  }) => {
    const thread = await deliverThread(mailbox, 'Offsite plan', FIVE);
    await mailbox.open('/app/mail');
    const row = page.getByText('Point number 5 of the plan.');
    await row.click();
    did('AL-050');
    await page.getByText('Reply...').waitFor();
    saw('STL-106');
    // Unread messages are open; read ones collapse on the next visit.
    await expect
      .poll(async () =>
        (await threadMessages(mailbox, thread.id)).every(
          (message) => message.is_read
        )
      )
      .toBe(true);
    // The next visit is made inside the app. A reload here can leave the
    // request that marked the thread seen claimed by the page that is gone,
    // and the new page then holds its draft saves back behind it for minutes.
    await page.keyboard.press('Escape');
    did('AL-123');
    await expect(page).toHaveURL(/\/app\/mail$/);
    await row.click();
    await page.getByRole('button', { name: 'Show 2 hidden messages' }).click();
    did('AL-166');
    const third = messageCard(page, 'Point number 3');
    await third.click();
    did('AL-505');
    await page.keyboard.press('r');
    did('AL-133');
    await third.getByRole('textbox', { name: /^Reply/ }).click();
    await page.keyboard.type('Half a thought on point three');
    did('AC-081');
    did('AC-911');
    await expect
      .poll(async () =>
        (await threadMessages(mailbox, thread.id))
          .filter((message) => message.is_draft)
          .map(
            (message) =>
              message.replying_to_id !== null &&
              /Half a thought on point three/.test(
                String(message.body_html_sanitized)
              )
          )
      )
      .toEqual([true]);

    await page.reload();
    await page.getByText('Reply...').waitFor();
    await expect(
      third.getByText('Half a thought on point three')
    ).toBeVisible();
    saw('STL-962');
    await expect(third.getByText('to Me')).toBeVisible();
    // The messages around it are still collapsed rows.
    await expect(
      messageCard(page, 'Point number 2').getByText('to Me')
    ).toHaveCount(0);
    await expect(
      messageCard(page, 'Point number 4').getByText('to Me')
    ).toHaveCount(0);
  });

  // Class web-thread-view: Escape leaves a thread for the list it was opened
  // from. When this fails Escape strands the user in the thread.
  test('Escape goes back to the list the thread was opened from', async ({
    page,
    mailbox,
  }) => {
    const thread = await deliverThread(mailbox, 'Offsite plan', FIVE);
    await mailbox.open('/app/mail');
    const row = page.getByText('Point number 5 of the plan.');
    await row.click();
    did('AL-050');
    await page.getByText('Reply...').waitFor();
    saw('STL-106');
    await expect(page).toHaveURL(new RegExp(`/app/mail/${thread.id}`));
    await page.keyboard.press('Escape');
    did('AL-123');
    await expect(page).toHaveURL(/\/app\/mail$/);
    await expect(row).toBeVisible();
    saw('STL-966');
  });

  // Class web-thread-view: `r` opens the reply with the caret in it. When this
  // fails the typed reply goes nowhere, or runs other shortcuts.
  test('r opens the reply with the caret in it', async ({ page, mailbox }) => {
    const thread = await deliverThread(mailbox, 'Offsite plan', FIVE);
    await mailbox.open(`/app/mail/${thread.id}`);
    did('AL-910');
    await page.getByText('Reply...').waitFor();
    saw('STL-106');
    await page.keyboard.press('r');
    did('AL-133');
    await page.keyboard.type('Sounds good');
    did('AC-081');
    await expect(page.getByRole('textbox', { name: /^Reply/ })).toHaveText(
      'Sounds good'
    );
    saw('STC-970');
  });

  test.describe('on a tablet', () => {
    test.use({
      hasTouch: true,
      isMobile: true,
      viewport: { width: 1024, height: 768 },
    });

    // Class web-thread-view: a tablet is touch at desktop width, and its reply
    // is the full-screen composer. When this fails tapping Reply does nothing.
    test('Reply opens the full-screen composer', async ({ page, mailbox }) => {
      const thread = await deliverThread(mailbox, 'Offsite plan', FIVE);
      await mailbox.open(`/app/mail/${thread.id}`);
      did('AL-910');
      // The bar under the thread, not the Reply icon on each message.
      await page
        .getByRole('button', { name: 'Reply', exact: true })
        .filter({ hasText: 'Reply' })
        .tap();
      did('AL-172', 'F-108');
      did('AL-172', 'F-113');
      const composer = page.getByRole('dialog', { name: 'Reply composer' });
      await expect(composer).toBeVisible();
      const body = composer.getByRole('textbox', { name: /reference files/ });
      await body.tap();
      await page.keyboard.type('From the tablet');
      await expect(body).toHaveText('From the tablet');
      saw('STC-970');
    });
  });
});

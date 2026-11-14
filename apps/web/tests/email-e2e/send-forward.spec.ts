import { expect, test } from './harness/fixtures';
import { header } from './harness/provider';
import {
  htmlBody,
  messageAction,
  notice,
  occurrences,
  onlySentRaw,
  replyEditor,
  threadMessages,
} from './harness/send';
import { confirmed, did, saw } from './ledger/record';

test.describe('forwarding from the thread', () => {
  // Class forward-empty-body-not-sendable: when this fails a forward with a
  // recipient and nothing typed counts as an empty draft, and Send does
  // nothing.
  test('a forward with nothing typed reaches its recipient', async ({
    page,
    mailbox,
  }) => {
    await mailbox.deliver({
      from: 'Grace <grace@example.com>',
      subject: 'Lunch?',
      text: 'Noon at the usual place?',
    });
    const thread = await mailbox.synced('Lunch?');

    await mailbox.open(`/app/mail/${thread.id}`);
    did('AL-910');
    await messageAction(page, 'Noon at the usual place?', 'forward');
    await expect(replyEditor(page)).toBeVisible();
    await page.getByRole('combobox').fill('zed@example.com');
    await page.keyboard.press('Enter');
    did('AC-077', 'F-097');
    did('AC-003');
    await expect(
      page.getByRole('link', { name: 'zed@example.com' })
    ).toBeVisible();
    saw('STC-958');
    await page.getByRole('button', { name: 'Send email' }).click();
    did('AC-091');
    await expect(notice(page, 'Sending…')).toBeVisible();
    saw('STC-024');

    const raw = await onlySentRaw(mailbox);
    expect(header(raw, 'Subject')).toBe('Fwd: Lunch?');
    expect(header(raw, 'To')).toContain('zed@example.com');
    confirmed('F-097');
    const html = htmlBody(raw);
    expect(html).toContain('---------- Forwarded message ----------');
    expect(html).toContain('Noon at the usual place?');
    confirmed('F-110');
    confirmed('F-132');
  });

  // Class reply-kind-not-preserved: nothing but its body records that a
  // saved draft is a forward. When this fails the draft comes back as a
  // reply to the original sender, or changing its kind leaves the other
  // kind's quoted block in the message.
  test('a saved forward reopens as a forward and is sent with one forwarded message', async ({
    page,
    mailbox,
  }) => {
    await mailbox.deliver({
      from: 'Grace <grace@example.com>',
      subject: 'Lunch?',
      html: '<p>Noon at the usual place?</p>',
      attachments: [
        {
          filename: 'menu.txt',
          mimeType: 'text/plain',
          base64: Buffer.from('soup of the day').toString('base64'),
        },
      ],
    });
    const thread = await mailbox.synced('Lunch?');
    const savedDrafts = async () =>
      (await threadMessages(mailbox, thread.id))
        .filter((message) => message.is_draft)
        .map((message) => ({
          to: message.to.map((recipient) => recipient.email),
          typed: JSON.stringify(message).includes('FYI'),
        }));

    await mailbox.open(`/app/mail/${thread.id}`);
    did('AL-910');
    await messageAction(page, 'Noon at the usual place?', 'forward');
    did('AL-900');
    await page.getByRole('combobox').fill('zed@example.com');
    await page.keyboard.press('Enter');
    did('AC-077', 'F-097');
    did('AC-003');
    await replyEditor(page).click();
    await replyEditor(page).pressSequentially('FYI');
    did('AC-081');
    did('AC-911');
    await expect
      .poll(savedDrafts, { timeout: 30_000 })
      .toEqual([{ to: ['zed@example.com'], typed: true }]);

    await page.reload();
    const forward = page.getByRole('textbox', { name: /^Forward — / });
    await expect(forward).toContainText('FYI');
    saw('STL-962');
    saw('STC-970');
    await expect(
      page.getByRole('button', { name: 'Forwarding zed@example.com' })
    ).toBeVisible();
    saw('STC-094', 'F-110');
    await expect(
      page.getByRole('button', { name: 'Remove menu.txt' })
    ).toBeVisible();
    saw('STL-971');

    // To a reply and back: each kind brings its own block and takes the other's away.
    await messageAction(page, 'Noon at the usual place?', 'reply');
    did('AL-113');
    await expect(
      page.getByRole('textbox', { name: /^Reply — / })
    ).toContainText('FYI');
    await expect(
      page.getByRole('button', { name: 'Replying to Grace' })
    ).toBeVisible();
    saw('STC-094', 'F-108');
    saw('STC-937');
    await messageAction(page, 'Noon at the usual place?', 'forward');
    await expect(forward).toContainText('FYI');
    await page.getByRole('combobox').fill('zed@example.com');
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('link', { name: 'zed@example.com' })
    ).toBeVisible();
    saw('STC-958');
    await page.getByRole('button', { name: 'Send email' }).click();
    did('AC-091');

    const raw = await onlySentRaw(mailbox);
    expect(header(raw, 'Subject')).toBe('Fwd: Lunch?');
    expect(header(raw, 'To')).toContain('zed@example.com');
    expect(header(raw, 'To')).not.toContain('grace@example.com');
    confirmed('F-097');
    const html = htmlBody(raw);
    expect(occurrences(html, '---------- Forwarded message ----------')).toBe(
      1
    );
    expect(occurrences(html, 'Noon at the usual place?')).toBe(1);
    expect(html).not.toMatch(/wrote:/);
    confirmed('F-110');
    expect(raw).toContain('filename="menu.txt"');
    confirmed('F-124');
    confirmed('F-132');
  });
});

// The inline reply and forward composer on a desktop: its empty placeholder,
// what its trash says before and after the reply is saved, a file dragged
// over it, and a forwarded attachment that cannot be opened.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { anInbox, PROVIDERS } from './harness/providers';
import { notice, replyEditor } from './harness/send';
import { dragFile, toolbarButtons, tooltip } from './harness/states-compose';
import {
  PIXEL,
  pressMessageButton,
  replyTo,
  textOf,
  XAVIER,
} from './harness/ways-compose2';
import { saw } from './ledger/record';

test.beforeEach(({ page }) => loadAppSteadily(page));

// When this fails, an empty reply no longer hints that people can be
// mentioned, a file dragged over the reply is not offered a place to drop,
// or the reply's trash does not tell an unsaved reply (Discard) from a
// saved draft (Delete draft). The composer's own text, the same whatever
// the provider: Gmail only.
test('an empty reply shows its hint, a dragged file is offered a drop, and the trash says Discard then Delete draft', async ({
  page,
  mailbox,
}) => {
  await replyTo(page, mailbox, 'Reply hints');
  await expect(
    page.getByText('Reply — @mention to share or cc people', { exact: true })
  ).toBeVisible();
  saw('STC-008');

  const editor = replyEditor(page);
  const drop = page.getByText('Drop file(s) to attach');
  await dragFile(editor, ['dragenter', 'dragover']);
  await expect(drop).toBeVisible();
  saw('STC-315');
  await dragFile(editor, ['dragleave']);
  await expect(drop).toBeHidden();

  // The reply's trash has a tooltip but no name: it comes first in the row.
  const trash = toolbarButtons(page).first();
  await trash.hover();
  await expect(tooltip(page, 'Discard')).toBeVisible();
  await page.mouse.move(0, 0);
  await editor.click();
  await page.keyboard.type('Saved as a draft.');
  await page.mouse.move(0, 0);
  await trash.hover();
  await expect(tooltip(page, 'Delete draft')).toBeVisible();
  saw('STC-096');
});

for (const provider of PROVIDERS) {
  test.describe(`forwarding from ${anInbox(provider)}`, () => {
    test.use({ provider });

    // When this fails, a forwarded attachment that cannot be fetched opens
    // nothing and says nothing. The attachment is the provider's.
    test('a forwarded attachment that fails to open says so', async ({
      page,
      mailbox,
    }) => {
      const subject = 'Pixel attached';
      await mailbox.deliver({
        from: `Xavier <${XAVIER}>`,
        to: mailbox.inbox.email,
        subject,
        text: textOf(subject),
        attachments: [
          { filename: 'pixel.png', mimeType: 'image/png', base64: PIXEL },
        ],
      });
      const thread = await mailbox.synced(subject);
      await page.route(/\/email\/attachments\/[^/?]+(\?|$)/, (route) =>
        route.fulfill({ status: 500, body: '{}' })
      );
      await mailbox.open(`/app/mail/${thread.id}`);
      await expect(page.getByText(textOf(subject)).first()).toBeVisible();
      await pressMessageButton(page, subject, 'Forward');
      await expect(
        page.getByRole('textbox', {
          name: 'Forward — @mention to share or cc people',
        })
      ).toBeVisible();
      // The forward's pill sits beside its own Remove button.
      await expect(
        page.getByRole('button', { name: 'Remove pixel.png' })
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'pixel.png', exact: true })
        .last()
        .click();
      await expect(
        notice(page, 'Unable to open this attachment')
      ).toBeVisible();
      saw('STC-012');
    });
  });
}

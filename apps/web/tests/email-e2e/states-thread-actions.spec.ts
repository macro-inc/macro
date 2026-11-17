// A message's own Reply, Reply all and Forward on the desktop: Reply all
// only when it reaches someone Reply does not, Forward only for the inbox
// that holds the thread.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { anInbox, PROVIDERS } from './harness/providers';
import { sharedByBob } from './harness/states-thread';
import { FROM } from './harness/ways-thread';
import { saw } from './ledger/record';

/** Opens a thread by its address and hovers its message, which shows the
 * message's own buttons. */
async function hoverMessage(
  page: Page,
  mailbox: Mailbox,
  id: string,
  text: string
): Promise<void> {
  await mailbox.open(`/app/mail/${id}`);
  await page.getByText(text).first().hover();
}

for (const provider of PROVIDERS) {
  test.describe(`a message's own buttons, ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a message only its sender would get offers Reply
    // all (which would reach no one Reply does not), or one with someone in
    // Cc does not.
    test('Reply all only with someone besides the sender', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: FROM,
        subject: 'Solo',
        text: 'About Solo.',
      });
      await mailbox.deliver({
        from: FROM,
        cc: 'Bob <bob@example.com>',
        subject: 'Group',
        text: 'About Group.',
      });
      const solo = (await mailbox.synced('Solo')).id;
      const group = (await mailbox.synced('Group')).id;
      const button = (name: string) =>
        page.getByRole('button', { name, exact: true });

      await hoverMessage(page, mailbox, solo, 'About Solo.');
      await expect(button('Reply')).toBeVisible();
      await expect(button('Forward')).toBeVisible();
      await expect(button('Reply all')).toHaveCount(0);

      await hoverMessage(page, mailbox, group, 'About Group.');
      await expect(button('Reply all')).toBeVisible();
      saw('STL-510', 'F-109');
    });
  });
}

// Who may forward a thread is Macro's own sharing, the same whichever
// mailbox holds it. Gmail only.
test.describe("a shared thread's message buttons", () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, a message of a thread shared with the viewer offers
  // Forward, which only the inbox holding its attachments can do.
  test('no Forward on a thread another user shared', async ({
    page,
    mailbox,
  }) => {
    const budget = await sharedByBob(mailbox, 'Budget');
    await hoverMessage(page, mailbox, budget, 'About Budget.');
    await expect(
      page.getByRole('button', { name: 'Reply', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Forward', exact: true })
    ).toHaveCount(0);
    saw('STL-510', 'F-110');
  });
});

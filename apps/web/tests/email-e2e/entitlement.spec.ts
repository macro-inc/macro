// The plan's inbox entitlement: an account without a paid plan holds two
// inboxes, of either provider, and the email service refuses a third. The
// third is a Google account in both runs, because the consent the suite can
// drive is Google's; the two inboxes that fill the plan are the provider's.

import type { Mailbox } from './harness/fixtures';
import { expect, test } from './harness/linking';
import { anInbox, PROVIDERS } from './harness/providers';
import { notice } from './harness/send';
import { confirmed, did, saw } from './ledger/record';

/** The addresses of the inboxes the signed-in user has connected. */
async function connectedInboxes(mailbox: Mailbox): Promise<string[]> {
  const response = await mailbox.api('/email/email/links');
  const { links } = (await response.json()) as {
    links: { email_address: string }[];
  };
  return links.map((link) => link.email_address).sort();
}

for (const provider of PROVIDERS) {
  test.describe(`the inbox entitlement of an account with ${anInbox(provider)}`, () => {
    test.use({ provider });

    // When this fails, an account on the free plan connects more inboxes
    // than the plan allows, or the refusal is not told: the person is left
    // on a blank page or is told the account was connected.
    test('a third inbox is refused on the free plan, and the person is told why', async ({
      page,
      mailbox,
      auth,
    }) => {
      // The second inbox fills the plan.
      await mailbox.stack.link(mailbox.user, provider, 'second@example.com');
      const allowed = [mailbox.inbox.email, 'second@example.com'].sort();
      expect(await connectedInboxes(mailbox)).toEqual(allowed);
      await auth.googleAccount({ email: 'third@example.com' });

      await mailbox.open('/app/mail');
      await page
        .getByRole('button', { name: 'Connect another account' })
        .click();
      did('AL-044');
      await page.waitForURL(/\/o\/oauth2\/v2\/auth/);
      await page.getByRole('button', { name: /third@example\.com/ }).click();

      await expect(
        notice(
          page,
          'A professional subscription is required to add another inbox.'
        )
      ).toBeVisible();
      saw('STX-024', 'F-174');
      await expect(page).toHaveURL(/\/app\/mail$/);
      await expect(notice(page, 'Account connected')).toHaveCount(0);

      // The service holds the two inboxes of the plan and nothing of the
      // third: no link, and no mail of it.
      expect(await connectedInboxes(mailbox)).toEqual(allowed);
      const third = await mailbox.stack.sql<{ id: string }>(
        `SELECT id FROM email_links WHERE lower(email_address) = 'third@example.com'`
      );
      expect(third).toEqual([]);
      confirmed('F-174');
    });
  });
}

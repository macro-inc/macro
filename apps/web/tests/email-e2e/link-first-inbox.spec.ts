import { devices } from '@playwright/test';
import type { Mailbox } from './harness/fixtures';
import { expect, test } from './harness/fixtures';

/** The addresses of the inboxes the signed-in user has connected. */
async function connectedInboxes(mailbox: Mailbox): Promise<string[]> {
  const response = await mailbox.api('/email/email/links');
  const { links } = (await response.json()) as {
    links: { email_address: string }[];
  };
  return links.map((link) => link.email_address);
}

/**
 * Makes the signed-in user someone who has only just signed up with Google:
 * the provider grant exists, no inbox has been set up, and the first-run
 * tutorial is not done.
 */
async function becomeNewSignUp(mailbox: Mailbox) {
  const removed = await mailbox.api(
    `/email/email/links/${mailbox.inbox.linkId}`,
    {
      method: 'DELETE',
    }
  );
  expect(removed.status).toBe(204);
  await expect.poll(() => connectedInboxes(mailbox)).toEqual([]);
  mailbox.front.stub(({ path }) => {
    if (path !== '/auth/user/legacy_user_permissions') return undefined;
    return {
      json: {
        userId: mailbox.user.macroUserId,
        email: mailbox.user.email,
        name: mailbox.user.email.split('@')[0],
        permissions: [],
        licenseStatus: 'active',
        tutorialComplete: false,
        group: null,
        hasChromeExt: false,
        hasTrialed: true,
        aiDataConsent: true,
        referralCode: null,
        createdAt: '2026-01-01T00:00:00Z',
      },
    };
  });
}

test.describe('a new sign-up arriving straight in the app on a phone', () => {
  // The phone layout is where a first-run user stays in the app shell; on a
  // desktop they are sent through onboarding, which connects mail itself.
  const { defaultBrowserType: _browser, ...phone } = devices['iPhone 13'];
  test.use(phone);

  // Class link-first-inbox-not-initialised: someone who signed up through
  // single sign-on lands in the app without passing a login screen, and the
  // app itself must set up their first inbox. When this fails they have no
  // mail and nothing tells them why.
  test('the app sets up the first inbox for a new sign-up who never saw a login screen', async ({
    mailbox,
  }) => {
    await becomeNewSignUp(mailbox);

    await mailbox.open('/app/mail');

    await expect
      .poll(() => connectedInboxes(mailbox))
      .toEqual([mailbox.inbox.email]);
  });
});

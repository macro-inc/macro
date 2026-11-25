import { devices } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import type { Mailbox } from './harness/fixtures';
import { expect, test } from './harness/fixtures';
import { saw } from './ledger/record';

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

const { defaultBrowserType: _browser, ...phone } = devices['iPhone 13'];

for (const [device, use] of [
  ['a phone', phone],
  ['a desktop', {}],
] as const) {
  test.describe(`a new sign-up arriving straight in the app on ${device}`, () => {
    // Phone and desktop browsers alike are sent from the app on to
    // onboarding, which renders outside the app shell: the app must have set
    // up the inbox by the time it sends them there.
    test.use(use);
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // Class link-first-inbox-not-initialised: someone who signed up through
    // single sign-on lands in the app without passing a login screen, and the
    // app itself must set up their first inbox. When this fails they have no
    // mail and nothing tells them why, and onboarding asks them to connect
    // the inbox they signed up with again.
    test('the app sets up the first inbox for a new sign-up who never saw a login screen', async ({
      page,
      mailbox,
    }) => {
      await becomeNewSignUp(mailbox);

      await mailbox.open('/app/mail');

      await expect(page).toHaveURL(/\/app\/onboarding\?next=%2Fmail$/);
      await expect
        .poll(() => connectedInboxes(mailbox))
        .toEqual([mailbox.inbox.email]);
      await page.getByRole('button', { name: 'Get started' }).click();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(page.getByText('Work email connected')).toBeVisible();
      saw('STX-214');
    });
  });
}

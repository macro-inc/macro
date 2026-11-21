// What connecting an inbox shows on the way: the "Email access required"
// prompt of a Google consent without the mail permission, the return page
// while the new inbox is still being set up (after Google and after
// Microsoft consent), the paywall when the plan allows no more inboxes, and
// the notices of a sign-up callback that could not connect the inbox.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { notice } from './harness/send';
import { holdRequests } from './harness/states-settings';
import { SETTINGS } from './harness/ways-settings';
import { expect, refuseMailAccess, test } from './harness/ways-settings-more';
import { saw } from './ledger/record';

const WORK = 'work@example.com';
const INIT = /\/email\/email\/init(\?|$)/;
const LINKS = /\/email\/email\/links(\?|$)/;

/** The page a consent returns to while the email service sets the inbox up. */
const finishing = (page: Page) =>
  page.getByRole('status').filter({ hasText: 'Finishing account connection…' });

test.beforeEach(({ page }) => loadAppSteadily(page));

test.describe('connecting a Google account', () => {
  // When this fails, a consent that left the mail permission unchecked comes
  // back without saying why nothing was connected, or the page a granted
  // consent returns to shows nothing (or no way back) while the inbox is
  // still being set up.
  test('a consent without mail access says so, and a granted one says it is finishing', async ({
    page,
    mailbox,
    auth,
  }) => {
    await auth.googleAccount({ email: WORK });
    await mailbox.open('/app/mail');
    await page.getByRole('button', { name: 'Connect another account' }).click();
    await refuseMailAccess(page, WORK);
    await expect(notice(page, 'Email access required')).toContainText(
      "Macro connects an account's email and calendar together, so keep the email permissions checked. The account was not connected."
    );
    saw('STX-030');

    const setUp = await holdRequests(page, INIT, 'POST');
    await mailbox.open(SETTINGS);
    await page
      .getByRole('button', { name: 'Connect a Google Workspace account' })
      .click();
    await page.waitForURL(/\/o\/oauth2\/v2\/auth/);
    await page.getByRole('button', { name: /work@example\.com/ }).click();
    await expect(finishing(page)).toBeVisible();
    await expect(
      finishing(page).getByRole('button', { name: 'Back to app' })
    ).toBeVisible();
    saw('STX-211', 'F-001');
    // Once the inbox is set up the page gives way to the app.
    setUp.release();
    await expect(finishing(page)).toBeHidden({ timeout: 30_000 });
  });
});

test.describe('connecting a Microsoft account', () => {
  test.use({ provider: 'OUTLOOK' });

  // When this fails, the page a Microsoft consent returns to shows nothing
  // (or no way back) while the inbox is still being set up.
  test('the page a Microsoft consent returns to says it is finishing', async ({
    page,
    mailbox,
  }) => {
    const { front, stack } = mailbox;
    const linkId = crypto.randomUUID();
    // The auth service's stand-in does not finish a Microsoft consent, so
    // this one sends the consent straight back to the app's return page, as
    // the auth service does once it has the grant. The inbox is still being
    // set up there (the email service's answer is held), which is all the
    // page shows.
    front.stub(({ method, path }) => {
      if (path === '/auth/link/email/providers') {
        return { json: { outlook: true, outlook_admin_consent_url: null } };
      }
      if (method !== 'POST' || path !== '/auth/link/outlook') return undefined;
      const back = new URL(`${front.origin}/app/inbox-link-callback`);
      back.search = new URLSearchParams({
        link_id: linkId,
        provider: 'outlook',
      }).toString();
      const authorization = new URL(
        `${stack.info.outlookUrl}/common/oauth2/v2.0/authorize`
      );
      authorization.search = new URLSearchParams({
        client_id: 'macro-e2e',
        redirect_uri: back.toString(),
        response_type: 'code',
        scope: 'openid email offline_access Mail.ReadWrite',
        state: linkId,
      }).toString();
      return {
        json: { authorization_url: authorization.toString(), link_id: linkId },
      };
    });
    await holdRequests(page, INIT, 'POST');

    await mailbox.open(SETTINGS);
    await page
      .getByRole('button', { name: 'Connect an Outlook account' })
      .click();
    await page.waitForURL(/\/oauth2\/v2\.0\/authorize/);
    await page
      .getByRole('button', {
        name: new RegExp(mailbox.inbox.email.replace(/\./g, '\\.')),
      })
      .click();
    await expect(finishing(page)).toBeVisible();
    await expect(
      finishing(page).getByRole('button', { name: 'Back to app' })
    ).toBeVisible();
    saw('STX-211', 'F-002');
    await expect(page).toHaveURL(/\/app\/inbox-link-callback\?/);
  });
});

// The paywall is the same for both providers; each is asked for in turn
// from a Gmail inbox's settings, with Outlook offered.
test.describe('connecting an inbox past the plan', () => {
  // When this fails, a connection the plan does not allow starts anyway,
  // fails without a word, or does not say an upgrade allows more inboxes.
  test('the paywall explains that more inboxes need an upgrade, for Gmail and Outlook', async ({
    page,
    mailbox,
  }) => {
    const asked: string[] = [];
    mailbox.front.stub(({ method, path }) => {
      if (path === '/auth/link/email/providers') {
        return { json: { outlook: true, outlook_admin_consent_url: null } };
      }
      if (
        method !== 'POST' ||
        (path !== '/auth/link/gmail' && path !== '/auth/link/outlook')
      ) {
        return undefined;
      }
      asked.push(path);
      return { status: 402, json: { message: 'payment required' } };
    });
    await mailbox.open(SETTINGS);
    // The plan's heading depends on the user's tier; what the paywall says
    // about inboxes is its description and its link.
    const paywall = page.getByRole('dialog').filter({
      hasText: 'Upgrade your plan to connect more than two inboxes.',
    });

    for (const name of [
      'Connect a Google Workspace account',
      'Connect an Outlook account',
    ]) {
      await page.getByRole('button', { name }).click();
      await expect(
        paywall.getByRole('link', { name: 'Learn more about multiple inboxes' })
      ).toBeVisible();
      saw('STX-025');
      await expect(page).toHaveURL(new RegExp(`${SETTINGS}$`));
      await page.keyboard.press('Escape');
      await expect(paywall).toBeHidden();
    }
    expect(asked).toEqual(['/auth/link/gmail', '/auth/link/outlook']);
  });
});

// The sign-up callback reads the inbox list and sets the inbox up the same
// way whatever the provider, so this runs on Gmail only.
test.describe('the sign-up callback of a Gmail inbox', () => {
  // When this fails, a sign-up whose inbox could not be set up (or whose
  // inbox list could not be read) lands in the app without saying the email
  // was not connected, or stays on the callback page.
  test('says the email was not connected when setting it up fails, and why when the inboxes cannot be read', async ({
    page,
    mailbox,
  }) => {
    // Any refusal but "already set up" is reported the same way; here the
    // email service fails.
    await page.route(INIT, (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 500, json: {} })
        : route.fallback()
    );
    await mailbox.open('/app/email-signup-callback');
    const failed = notice(page, 'Failed to connect email');
    await expect(failed).toContainText(
      'Select email permissions on sign-in to enable'
    );
    saw('STX-212');
    await expect(page).not.toHaveURL(/email-signup-callback/);

    await page.unroute(INIT);
    const listing = await holdRequests(page, LINKS, 'GET');
    listing.fail();
    await mailbox.open('/app/email-signup-callback');
    await expect(notice(page, 'Internal server error')).toBeVisible({
      timeout: 15_000,
    });
    saw('STX-212');
    await expect(page).not.toHaveURL(/email-signup-callback/);
  });
});

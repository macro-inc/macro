// Signing out with a draft that only this device holds, and answering
// "Sign out" to the question that asks first.

import type { Page } from '@playwright/test';
import {
  composeNew,
  draftThreads,
  graphqlOperation,
  loadAppSteadily,
} from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { anInbox, PROVIDERS } from './harness/providers';
import { did } from './ledger/record';

/** Opens Drafts and gives the row of the draft written here. */
async function draftRow(page: Page) {
  await page
    .getByRole('navigation', { name: 'Email tabs' })
    .getByRole('button', { name: 'Drafts' })
    .click();
  return page
    .getByRole('grid', { name: 'Email' })
    .getByRole('row')
    .filter({ hasText: 'Offsite plan' });
}

test.beforeEach(({ page }) => loadAppSteadily(page));

for (const provider of PROVIDERS) {
  test.describe(`signing out of ${anInbox(provider)}`, () => {
    test.use({ provider });

    // When this fails, "Sign out" in "Sign out and remove local drafts?"
    // does not end the session at the authentication service, does not
    // leave the app, or leaves the draft only this device held behind for
    // whoever signs in next.
    test('Sign out in the question ends the session and removes the draft only this device held', async ({
      page,
      mailbox,
    }) => {
      // No save reaches the server: the draft is only on this device.
      let dropped = 0;
      await page.route(/\/graphql$/, async (route) => {
        if (graphqlOperation(route.request()) !== 'SaveEmailDraft')
          return route.fallback();
        dropped += 1;
        await route.abort();
      });
      await composeNew(page, mailbox, {
        to: 'grace@example.com',
        subject: 'Offsite plan',
        body: 'Thinking of the coast.',
      });
      await expect.poll(() => dropped).toBeGreaterThan(0);
      await mailbox.open('/app/mail');
      await expect(await draftRow(page)).toHaveCount(1);

      // The authentication service's end of signing out, and the page the
      // browser is sent to after it, which is not the app's.
      let endedSessions = 0;
      mailbox.front.stub(({ method, path }) => {
        if (method !== 'POST' || path !== '/auth/logout') return undefined;
        endedSessions += 1;
        return { json: {} };
      });
      const leftFor: string[] = [];
      await page.route(
        (url) => url.origin !== mailbox.front.origin,
        async (route) => {
          const request = route.request();
          if (
            !request.isNavigationRequest() ||
            request.frame() !== page.mainFrame()
          ) {
            return route.fallback();
          }
          leftFor.push(request.url());
          await route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><title>Signed out</title><h1>Signed out</h1>',
          });
        }
      );

      await mailbox.open('/app/mail/~/settings/account');
      await page.getByRole('button', { name: 'Log out', exact: true }).click();
      const question = page
        .getByRole('alertdialog')
        .or(page.getByRole('dialog'))
        .filter({ hasText: 'Sign out and remove local drafts?' });
      await question
        .getByRole('button', { name: 'Sign out', exact: true })
        .click();
      did('AX-215');
      await expect(
        page.getByRole('heading', { name: 'Signed out' })
      ).toBeVisible();
      expect(leftFor).toHaveLength(1);
      expect(endedSessions).toBe(1);

      // Signed in again, the draft is gone: the server never had it. Drafts
      // has answered once it shows its empty state or that the server's
      // list could not be read; the drafts this device holds are listed in
      // either case, as the one written here was before signing out.
      await mailbox.open('/app/mail');
      const row = await draftRow(page);
      await expect(
        page
          .getByText('No drafts')
          .or(page.getByText(/^Email couldn.t be loaded\.$/))
      ).toBeVisible();
      await expect(row).toHaveCount(0);
      expect(await draftThreads(mailbox)).toEqual([]);
    });
  });
}

// What the universal input says when Connect Google cannot start a
// connection. On the web, a refused request to start one is reported by the
// connect flow itself ("Failed to start inbox connection"); the universal
// input's own notice is for a start the flow cannot carry through. Here the
// authentication service answers with an address for Google's consent
// screen that the browser cannot open.
//
// The authentication service is not in the stack: the answer is given by
// the page's route, in place of the stand-in of `harness/linking.ts`.

import type { Page, Request } from '@playwright/test';
import { expect, test } from './harness/linking';
import { anInbox, PROVIDERS } from './harness/providers';
import { notice } from './harness/send';
import { chooseEmail } from './harness/states-elsewhere';
import {
  disconnectInbox,
  openUniversalInput,
  REQUEST,
  universalInput,
} from './harness/ways-elsewhere';
import { PHONE } from './harness/ways-list1';
import { did, saw } from './ledger/record';

/** Not an address: the browser refuses to go to it. */
const UNOPENABLE = 'http://[';

/**
 * Answers the app's requests to start a Google connection with an address of
 * the consent screen the browser cannot open, and records them.
 */
async function answerUnopenableConsent(page: Page): Promise<Request[]> {
  const starts: Request[] = [];
  await page.route(/\/auth\/link\/gmail(\?|$)/, async (route) => {
    starts.push(route.request());
    await route.fulfill({
      json: {
        authorization_url: UNOPENABLE,
        link_id: crypto.randomUUID(),
      },
    });
  });
  return starts;
}

for (const provider of PROVIDERS) {
  test.describe(`Connect Google in the universal input, with ${anInbox(provider)} gone`, () => {
    test.use({ provider });

    // When this fails, Connect Google in the universal input fails to start
    // a connection without a word: no notice says so, the page goes
    // somewhere, or the button stays held as if a connection were starting.
    // The inbox is disconnected first, so the provider it had decides nothing.
    test('Connect Google that cannot open the consent screen says so, and can be pressed again', async ({
      page,
      mailbox,
      auth,
    }) => {
      const starts = await answerUnopenableConsent(page);
      await disconnectInbox(mailbox);
      const input = universalInput(page);
      const connect = input.getByRole('button', { name: 'Connect Google' });
      const failed = notice(
        page,
        'Could not connect Google. Please try again.'
      );

      await mailbox.open('/app/mail');
      await openUniversalInput(page);
      await chooseEmail(page);
      await connect.click();
      did('AX-051');
      await expect(failed).toBeVisible();
      saw('STX-302');

      // The connection was asked for, for mail and calendar, and nothing
      // else happened: the page stayed, and the button is free again.
      expect(starts.map((start) => start.method())).toEqual(['POST']);
      expect(new URL(starts[0].url()).searchParams.get('scopes')).toBe(
        'gmail_and_calendar'
      );
      expect(auth.starts).toEqual([]);
      await expect(page).toHaveURL(/\/app\/mail/);
      await expect(connect).toBeEnabled();
    });
  });
}

// Gmail only: what the phone shows is the screen's, whatever the inbox was.
test.describe('Connect Google in the universal input on a phone, with the inbox gone', () => {
  test.use({ ...PHONE, provider: 'GMAIL' });

  // When this fails, Connect Google in the phone's universal input (the
  // dock's Search, given a request) fails to start a connection without a
  // word, or the page goes somewhere.
  test("Connect Google in the phone's search that cannot open the consent screen says so", async ({
    page,
    mailbox,
    auth,
  }) => {
    const starts = await answerUnopenableConsent(page);
    await disconnectInbox(mailbox);
    const connect = page.getByRole('button', { name: 'Connect Google' });
    const failed = notice(page, 'Could not connect Google. Please try again.');

    await mailbox.open('/app/mail');
    expect(await page.evaluate(() => window.innerWidth)).toBe(
      PHONE.viewport.width
    );
    await page.getByRole('button', { name: 'Search', exact: true }).tap();
    await page.getByRole('textbox', { name: 'Search or create' }).fill(REQUEST);
    await page.getByRole('button', { name: 'Content type' }).tap();
    await page.getByRole('option', { name: 'Email' }).tap();
    // The dock's Search has its own page; the tap must not leave it.
    const searching = page.url();
    await connect.tap();
    did('AX-051');
    await expect(failed).toBeVisible();
    saw('STX-302');

    expect(starts).toHaveLength(1);
    expect(auth.starts).toEqual([]);
    await expect(page).toHaveURL(searching);
    await expect(connect).toBeEnabled();
  });
});

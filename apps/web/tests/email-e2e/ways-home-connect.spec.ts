// The way into connecting an inbox from Home, for someone with no inbox
// left: "Connect email" in Home's empty state, under "Welcome home", for a
// Gmail and an Outlook account. Each connection goes through the provider's
// own consent page at its emulator.

import { anInbox, PROVIDERS } from './harness/providers';
import { notice } from './harness/send';
import {
  chooser,
  expect,
  homeList,
  subjectsIn,
  test,
  watchedAtProvider,
} from './harness/ways-home';
import { connectedInboxes, links, removeInbox } from './harness/ways-settings';
import { confirmed, did } from './ledger/record';

/** The account connected from Home: nobody had connected it before. */
const WORK = 'work@example.com';

/** What differs between the providers along the same path. */
const WAYS = {
  GMAIL: {
    choice: 'Gmail',
    consent: /\/o\/oauth2\/v2\/auth/,
    starts: { google: 1, microsoft: 0 },
    pressed: () => did('AX-316', 'F-001'),
    connected: () => confirmed('F-001'),
  },
  OUTLOOK: {
    choice: 'Outlook / Microsoft 365',
    consent: /\/oauth2\/v2\.0\/authorize/,
    starts: { google: 0, microsoft: 1 },
    pressed: () => did('AX-316', 'F-002'),
    connected: () => confirmed('F-002'),
  },
} as const;

for (const provider of PROVIDERS) {
  test.describe(`Home with no inbox left, connecting ${anInbox(provider)}`, () => {
    test.use({ provider, outlookOffered: true });

    // When this fails, "Connect email" in Home's empty state no longer starts
    // a connection (no provider chooser, or no consent page for the provider
    // chosen), or the connection it starts does not end with the account
    // connected: the email service does not list it, Macro does not watch it
    // at the provider, or its mail never reaches Macro.
    test(`Connect email under Welcome home connects ${anInbox(provider)} and its mail arrives`, async ({
      page,
      mailbox,
      auth,
      microsoft,
    }) => {
      const way = WAYS[provider];
      await mailbox.stack.seed(provider, WORK, [
        {
          from: 'Linus <linus@example.com>',
          subject: 'Budget',
          text: 'Numbers attached.',
        },
      ]);
      expect(await watchedAtProvider(mailbox, provider, WORK)).toBe(false);
      await removeInbox(mailbox);

      await mailbox.open('/app/home');
      const home = homeList(page);
      await expect(
        home.getByRole('heading', { name: 'Welcome home' })
      ).toBeVisible();
      await home.getByRole('button', { name: 'Connect email' }).click();
      way.pressed();
      await chooser(page).getByRole('button', { name: way.choice }).click();
      await page.waitForURL(way.consent);
      await page.getByRole('button', { name: new RegExp(WORK) }).click();

      await expect(notice(page, 'Account connected')).toBeVisible();
      await expect(page).toHaveURL(/\/app\/home/);
      expect({
        google: auth.starts.length,
        microsoft: microsoft.starts.length,
      }).toEqual(way.starts);
      await expect.poll(() => connectedInboxes(mailbox)).toEqual([WORK]);
      const [link] = await links(mailbox);
      expect(link.provider).toBe(provider);
      await expect
        .poll(() => watchedAtProvider(mailbox, provider, WORK), {
          message: `Macro never watched ${WORK} at the provider`,
          timeout: 60_000,
        })
        .toBe(true);
      way.connected();
      await expect
        .poll(() => subjectsIn(mailbox, link.id), {
          message: `the mail of ${WORK} never reached Macro`,
          timeout: 60_000,
        })
        .toContain('Budget');
    });
  });
}

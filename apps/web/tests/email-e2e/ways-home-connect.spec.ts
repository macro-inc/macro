// The way into connecting an inbox from Home, for someone with no inbox
// left: "Connect email" in Home's empty state, under "Welcome home", for a
// Gmail and an Outlook account. Each connection goes through the provider's
// own consent page at its emulator.
//
// Home's other invitation, "Connect your inbox for suggested actions"
// (AX-317), shows only once the assistant has answered Home's suggestions.
// The stack runs no assistant: `POST /cognition/ai-projections` finds no
// service, and the section says "Suggestions are unavailable right now."
// instead (`deriveRecommendedView` in
// `src/lib/queries/ai/homeRecommendations.ts`). Its test answers that request
// itself, with what the assistant answers when nothing qualifies.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
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

/**
 * Answers Home's suggestions as the assistant does when nothing is worth
 * suggesting: a finished projection holding no items. Home asks for two (a
 * fast one, and a smart one on a paid plan); both get the same answer.
 * Returns the projections asked for.
 */
async function answerNoSuggestions(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route(/\/cognition\/ai-projections(\?|$)/, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const { id } = route.request().postDataJSON() as { id: string };
    asked.push(id);
    const generated = new Date();
    await route.fulfill({
      json: {
        id,
        status: 'ready',
        data: JSON.stringify({ items: [] }),
        error: null,
        generated_at: generated.toISOString(),
        stale_at: new Date(generated.getTime() + 60 * 60_000).toISOString(),
      },
    });
  });
  return asked;
}

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

// Once, on Gmail: the invitation only opens Settings › Email, which offers
// both providers whichever inbox was removed.
test.describe('Home with no inbox left, its suggestions answered', () => {
  test.use({ outlookOffered: true });

  // Home's suggestions here are a stand-in (`answerNoSuggestions`): the
  // stack runs no assistant, so the test answers the request for them, with
  // no items. It proves the invitation and where it leads, not that the
  // assistant's own answer brings the invitation up. The test claims no
  // function: it stops at Settings, so `limits.tsv` needs no line for it.
  //
  // When this fails, Home's suggestions no longer invite someone with no
  // inbox to connect one ("Connect your inbox for suggested actions" is
  // missing), or the invitation does not open Settings › Email with its
  // controls to connect a Google Workspace or an Outlook account.
  test('Connect your inbox for suggested actions opens Settings › Email', async ({
    page,
    mailbox,
    // The authentication service stand-in, which also offers Outlook.
    auth,
  }) => {
    await loadAppSteadily(page);
    const asked = await answerNoSuggestions(page);
    await removeInbox(mailbox);

    await mailbox.open('/app/home');
    await page
      .getByRole('region', { name: 'Suggested actions' })
      .getByRole('button', {
        name: 'Connect your inbox for suggested actions',
      })
      .click();
    did('AX-317', 'F-001');

    await expect(page).toHaveURL(/\/settings\/email$/);
    await expect(
      page.getByRole('heading', { name: 'Email', level: 1 })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Connect a Google Workspace account' })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Connect an Outlook account' })
    ).toBeVisible();
    expect(asked).toContain('home/recommended-fast');
    expect(auth.starts).toEqual([]);
  });
});

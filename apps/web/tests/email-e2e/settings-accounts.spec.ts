import type { Mailbox } from './harness/fixtures';
import { expect, test } from './harness/fixtures';
import { PROVIDERS } from './harness/providers';
import { confirmed, did, saw } from './ledger/record';

type Link = {
  email_address: string;
  provider: string;
  is_primary: boolean;
  needs_calendar_permission: boolean;
  calendar_disabled: boolean;
};

/** The inboxes of the signed-in user as the email service answers them. */
async function links(mailbox: Mailbox): Promise<Link[]> {
  const response = await mailbox.api('/email/email/links');
  const body = (await response.json()) as { links: Link[] };
  return body.links.sort((a, b) =>
    a.email_address.localeCompare(b.email_address)
  );
}

const MAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];

/**
 * Leaves a Gmail inbox holding the calendar permission, as after its owner
 * granted it at Google. An Outlook inbox is connected with it.
 */
async function grantCalendar(mailbox: Mailbox) {
  const scopes = [MAIL_SCOPE, ...CALENDAR_SCOPES]
    .map((scope) => `'${scope}'`)
    .join(',');
  await mailbox.stack.sql(
    `INSERT INTO email_link_google_scopes (link_id, granted_scopes)
     VALUES ('${mailbox.inbox.linkId}', ARRAY[${scopes}]::text[])
     ON CONFLICT (link_id) DO UPDATE SET granted_scopes = EXCLUDED.granted_scopes
     RETURNING link_id`
  );
}

for (const provider of PROVIDERS) {
  const label = provider === 'GMAIL' ? 'Gmail' : 'Outlook / Microsoft 365';

  test.describe(`the accounts in Settings (${provider})`, () => {
    test.use({ provider });

    // Class settings-accounts-load: when the accounts cannot be loaded,
    // Settings must say so and offer to try again, and trying again must list
    // every connected inbox with its provider and which one is primary. When
    // this fails the section stays empty or on its error for good, or a
    // second inbox is missing or shown as the primary one.
    test('a failed load offers Try again, which lists each inbox with its provider and the primary one', async ({
      page,
      mailbox,
    }) => {
      await mailbox.stack.link(mailbox.user, provider, 'work@example.com');
      let failing = true;
      await page.route(/\/email\/email\/links(\?|$)/, async (route) => {
        if (failing && route.request().method() === 'GET') {
          await route.fulfill({ status: 500, json: {} });
          return;
        }
        await route.fallback();
      });

      await mailbox.open('/app/mail/~/settings/email');
      const failed = page
        .locator('[data-settings-target]')
        .filter({ hasText: "Couldn't load accounts" })
        .last();
      await expect(failed).toBeVisible({ timeout: 45_000 });
      saw('STX-002');
      await expect(
        page.getByRole('button', { name: 'Remove work@example.com' })
      ).toHaveCount(0);

      // The load starts working at the click, not before it: the app's own
      // retries, still running under the message, must not be what lists
      // the inboxes.
      await page.exposeFunction('emailE2eLoadsAgain', () => {
        failing = false;
      });
      // Heard on the document, since the message is drawn again when the
      // app gives up retrying and a listener on the button would be lost.
      await page.evaluate(() =>
        document.addEventListener(
          'click',
          (event) => {
            const button = (event.target as Element).closest('button');
            if (button?.textContent?.trim() !== 'Try again') return;
            (
              window as unknown as { emailE2eLoadsAgain(): void }
            ).emailE2eLoadsAgain();
          },
          { capture: true }
        )
      );
      await failed.getByRole('button', { name: 'Try again' }).click();
      did('AX-013');

      const row = (address: string) =>
        page
          .locator('div')
          .filter({
            has: page.getByRole('button', { name: `Remove ${address}` }),
          })
          .filter({ hasText: address })
          .last();
      await expect(row(mailbox.inbox.email)).toContainText(
        `${mailbox.inbox.email}Primary${label}`
      );
      await expect(row('work@example.com')).toContainText(
        `work@example.com${label}`
      );
      await expect(row('work@example.com')).not.toContainText('Primary');
      saw('STX-009');
      await expect(page.getByText("Couldn't load accounts")).toBeHidden();

      expect(
        (await links(mailbox)).map((link) => ({
          address: link.email_address,
          provider: link.provider,
          primary: link.is_primary,
        }))
      ).toEqual([
        { address: mailbox.inbox.email, provider, primary: true },
        { address: 'work@example.com', provider, primary: false },
      ]);
    });

    // Class calendar-turn-off: turning the calendar off for an inbox must
    // ask first, then say it is off, offer to enable it again, and the
    // service must hold it off. When this fails the calendar keeps syncing
    // for someone who turned it off, or Settings still offers to turn it off.
    test('turning the calendar off for an inbox asks first, then leaves it off and offers to enable it', async ({
      page,
      mailbox,
    }) => {
      if (provider === 'GMAIL') await grantCalendar(mailbox);
      const address = mailbox.inbox.email;
      expect(
        (await links(mailbox)).map((link) => ({
          missing: link.needs_calendar_permission,
          off: link.calendar_disabled,
        }))
      ).toEqual([{ missing: false, off: false }]);

      await mailbox.open('/app/mail/~/settings/email');
      const turnOff = page.getByRole('button', {
        name: `Turn off calendar for ${address}`,
      });
      const enable = page.getByRole('button', {
        name: `Enable calendar for ${address}`,
      });
      await expect(turnOff).toBeVisible();
      await expect(enable).toHaveCount(0);

      await turnOff.click();
      did('AX-006');
      const dialog = page.getByRole('dialog', { name: 'Turn off calendar' });
      await dialog
        .getByRole('button', { name: 'Turn off', exact: true })
        .click();
      did('AX-007');

      await expect(page.getByText('Calendar turned off')).toBeVisible();
      saw('STX-014');
      await expect(dialog).toBeHidden();
      await expect(enable).toBeVisible();
      await expect(turnOff).toHaveCount(0);

      expect(
        (await links(mailbox)).map((link) => ({
          missing: link.needs_calendar_permission,
          off: link.calendar_disabled,
        }))
      ).toEqual([{ missing: true, off: true }]);
      confirmed('F-157');
    });
  });
}

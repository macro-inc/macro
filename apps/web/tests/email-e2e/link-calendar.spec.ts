import type { Page } from '@playwright/test';
import type { Mailbox } from './harness/fixtures';
import { expect, test } from './harness/linking';
import { did } from './ledger/record';

const MAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';

/** The scopes the provider's consent page is asking the person to grant. */
async function scopesOnConsentPage(page: Page): Promise<string[]> {
  await page.waitForURL(/\/o\/oauth2\/v2\/auth/);
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  const scopes = await page
    .locator('label:has(input[type="checkbox"])')
    .allInnerTexts();
  return scopes.map((scope) => scope.trim()).sort();
}

/** Leaves the inbox holding a synced calendar account, as after calendar use. */
async function holdCalendarData(mailbox: Mailbox) {
  await mailbox.stack.sql(
    `INSERT INTO calendar_accounts (id, owner_id, email_link_id, provider, provider_account_id)
     VALUES (gen_random_uuid(), '${mailbox.user.macroUserId}', '${mailbox.inbox.linkId}', 'google', '${mailbox.inbox.email}')
     RETURNING id`
  );
}

/** Marks the inbox as needing its provider grant renewed. */
async function lapseGrant(mailbox: Mailbox) {
  await mailbox.stack.sql(
    `UPDATE email_links SET needs_reauth = true WHERE id = '${mailbox.inbox.linkId}' RETURNING id`
  );
}

test.describe('calendar access for a connected inbox', () => {
  // Class calendar-scope-through-consent: an inbox that still holds calendar
  // data must offer "Turn off calendar" even when its calendar permission is
  // gone. When this fails the data cannot be removed from Settings at all.
  test('an inbox holding calendar data offers Turn off calendar although its calendar permission is missing', async ({
    page,
    mailbox,
  }) => {
    const address = mailbox.inbox.email;
    const enable = page.getByRole('button', {
      name: `Enable calendar for ${address}`,
    });
    const turnOff = page.getByRole('button', {
      name: `Turn off calendar for ${address}`,
    });

    await mailbox.open('/app/mail/~/settings/email');
    await expect(enable).toBeVisible();
    await expect(turnOff).toHaveCount(0);

    await holdCalendarData(mailbox);
    await mailbox.open('/app/mail/~/settings/email');
    await expect(enable).toBeVisible();
    await expect(turnOff).toBeVisible();
  });

  // Class calendar-scope-through-consent: renewing the grant of an inbox
  // that used a calendar asks for mail and calendar together. When this
  // fails the reconnect asks for mail only and the calendar silently stops.
  test('reconnecting an inbox that used a calendar asks consent for mail and calendar', async ({
    page,
    mailbox,
    auth,
  }) => {
    await holdCalendarData(mailbox);
    await lapseGrant(mailbox);

    await mailbox.open('/app/mail/~/settings/email');
    await page
      .getByRole('button', { name: `Reconnect ${mailbox.inbox.email}` })
      .click();
    did('AX-004');

    expect(await scopesOnConsentPage(page)).toEqual([
      CALENDAR_SCOPE,
      MAIL_SCOPE,
    ]);
    expect(
      auth.starts.map(({ scopes, reconnectLinkId }) => ({
        scopes,
        reconnectLinkId,
      }))
    ).toEqual([
      { scopes: 'gmail_and_calendar', reconnectLinkId: mailbox.inbox.linkId },
    ]);
  });

  // Class calendar-scope-through-consent: renewing the grant of an inbox
  // that never used a calendar asks for mail only. When this fails the
  // reconnect asks for calendar access nobody opted into.
  test('reconnecting an inbox that never used a calendar asks consent for mail only', async ({
    page,
    mailbox,
    auth,
  }) => {
    await lapseGrant(mailbox);

    await mailbox.open('/app/mail/~/settings/email');
    await page
      .getByRole('button', { name: `Reconnect ${mailbox.inbox.email}` })
      .click();
    did('AX-004');

    expect(await scopesOnConsentPage(page)).toEqual([MAIL_SCOPE]);
    expect(
      auth.starts.map(({ scopes, reconnectLinkId }) => ({
        scopes,
        reconnectLinkId,
      }))
    ).toEqual([{ scopes: 'gmail', reconnectLinkId: mailbox.inbox.linkId }]);
  });
});

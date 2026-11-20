// The other ways to choose whose mail the list shows: the header's inbox
// menu, and the row of a send-as alias in the sidebar's account menu and in
// the phone's filter drawer.

import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { anInbox, PROVIDERS } from './harness/providers';
import { expectRows, filterGroup, GRACE, PHONE } from './harness/ways-list1';
import { did } from './ledger/record';

const WORK = 'work@example.com';
const ALIAS = 'sales@example.com';

for (const provider of PROVIDERS) {
  test.describe(`the header inbox menu with ${anInbox(provider)} and a second inbox`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, the header's inbox menu does not switch the list to
    // the inbox chosen in it, or "All inboxes" does not bring the rest back.
    test('an inbox chosen in the header menu is the only one listed', async ({
      page,
      mailbox,
    }) => {
      await mailbox.stack.link(mailbox.user, provider, WORK);
      await mailbox.stack.deliver(WORK, {
        from: GRACE,
        subject: 'Work',
        text: 'About work.',
      });
      await mailbox.deliver({ from: GRACE, subject: 'Lunch?', text: 'Noon?' });
      const work = (await mailbox.synced('Work')).id;
      const lunch = (await mailbox.synced('Lunch?')).id;
      const menuButton = filterGroup(page).getByRole('button', {
        name: /^Inbox: /,
      });

      await mailbox.open();
      await expectRows(page, [work, lunch]);

      await menuButton.click();
      await page.getByRole('menuitemradio', { name: WORK }).click();
      did('AL-042');
      await expectRows(page, [work]);
      await expect(menuButton).toHaveAccessibleName(`Inbox: ${WORK}`);

      if (!(await page.getByRole('menuitemradio').first().isVisible()))
        await menuButton.click();
      await page.getByRole('menuitemradio', { name: 'All inboxes' }).click();
      await expectRows(page, [work, lunch]);
    });
  });
}

/**
 * A second Gmail inbox with a send-as alias, holding one message to the alias
 * and one to the inbox's own address. The inbox is made in the emulator with
 * its alias first, then linked through the stack, as send-delivery.spec.ts
 * does, so the stack can deliver to it.
 */
async function aliasInbox(
  mailbox: Mailbox
): Promise<{ sales: string; own: string }> {
  const created = await fetch(
    `${mailbox.stack.info.gmailUrl}/_emulator/mailboxes`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: WORK, send_as: [{ email: ALIAS }] }),
    }
  );
  expect(created.ok).toBe(true);
  await mailbox.stack.link(mailbox.user, 'GMAIL', WORK);
  await mailbox.stack.deliver(WORK, {
    from: GRACE,
    to: ALIAS,
    subject: 'For sales',
    text: 'A question for sales.',
  });
  await mailbox.stack.deliver(WORK, {
    from: GRACE,
    subject: 'For work',
    text: 'A question for work.',
  });
  return {
    sales: (await mailbox.synced('For sales')).id,
    own: (await mailbox.synced('For work')).id,
  };
}

// Gmail only: a send-as alias comes from a Google account's settings.
test.describe('the alias row of a Gmail inbox', () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, the row of an alias in the account menu does not narrow
  // the list to the mail of that address: it lists the whole inbox, or
  // nothing.
  test('the alias row lists only the mail to that address', async ({
    page,
    mailbox,
  }) => {
    const { sales, own } = await aliasInbox(mailbox);
    await mailbox.open();
    await expectRows(page, [sales, own]);

    await page
      .getByRole('button', { name: 'Select inbox: All inboxes' })
      .click();
    await page
      .getByRole('menu')
      .getByRole('menuitemradio')
      .filter({ hasText: 'Alias' })
      .filter({ hasText: ALIAS })
      .click();
    did('AL-040');
    await expectRows(page, [sales]);
    await expect(
      page.getByRole('button', { name: `Select inbox: ${ALIAS}` })
    ).toBeVisible();
  });
});

// Gmail only, for the same reason.
test.describe('the alias row of a Gmail inbox on a phone', () => {
  test.use({ ...PHONE, provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, the alias row of the filter drawer's Inbox section does
  // not narrow the list to the mail of that address.
  test("the drawer's alias row lists only the mail to that address", async ({
    page,
    mailbox,
  }) => {
    const { sales, own } = await aliasInbox(mailbox);
    const drawer = page.getByRole('dialog', { name: 'Email filters' });
    const alias = drawer
      .getByRole('group', { name: 'Inbox' })
      .getByRole('checkbox', { name: /sales@example\.com/ });
    await mailbox.open();
    expect(await page.evaluate(() => window.innerWidth)).toBe(
      PHONE.viewport.width
    );
    await expectRows(page, [sales, own]);

    await page.getByRole('button', { name: 'Open email filters' }).tap();
    await alias.tap();
    did('AL-040');
    await expectRows(page, [sales]);
    await expect(alias).toBeChecked();
  });
});

// The other ways to the tabs of the mail list: the sidebar's Inbox item, the
// number keys, Tab and Shift+Tab, and the phone's pills, each for a Gmail and
// an Outlook inbox; and the header breadcrumb's name.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { deliverToSpam, spamFolder, syncedInView } from './harness/journeys';
import { deliverNoise, openThreadId } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import { expectRows, GRACE, listQuery, PHONE } from './harness/ways-list1';
import { confirmed, did } from './ledger/record';

for (const provider of PROVIDERS) {
  test.describe(`the other ways to the tabs of ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, one of the desktop's other ways to a tab is dead or
    // opens the wrong tab: a number key, Tab or Shift+Tab between the Inbox
    // tabs, or the sidebar's Inbox item.
    test('number keys, Tab and the sidebar Inbox item each open their tab', async ({
      page,
      mailbox,
    }) => {
      await deliverNoise(mailbox, {
        from: 'Deals <deals@example.com>',
        subject: 'Sale',
        text: 'Everything must go.',
      });
      await mailbox.deliver({ from: GRACE, subject: 'Lunch?', text: 'Noon?' });
      const lunch = (await mailbox.synced('Lunch?')).id;
      const sale = (await mailbox.synced('Sale')).id;
      const inboxTabs = page.getByRole('radiogroup', { name: 'Inbox view' });
      const checked = (name: string) =>
        expect(inboxTabs.getByRole('radio', { name })).toBeChecked();

      await mailbox.open();
      await expectRows(page, [lunch]);

      // 7 is All mail: Signal, Favorites, Drafts, Sent, Scheduled,
      // Reminders, then the Library.
      await page.keyboard.press('7');
      did('AL-006', 'F-030');
      await expect(page).toHaveURL(/mail\.tab=all/);
      await expectRows(page, [lunch, sale]);

      // The sidebar's Inbox item leads back to Signal.
      await page
        .getByRole('navigation', { name: 'Email tabs' })
        .getByRole('button', { name: 'Inbox' })
        .click();
      did('AL-001');
      await checked('Signal');
      await expectRows(page, [lunch]);

      // The focus is on the sidebar, not in the list: Tab walks the Inbox
      // tabs, Signal to Noise, and Shift+Tab back.
      await page.keyboard.press('Tab');
      did('AL-007');
      await checked('Noise');
      await expectRows(page, [sale]);
      await page.keyboard.press('Shift+Tab');
      await checked('Signal');
      await expectRows(page, [lunch]);

      // 1 is Signal, from any tab.
      await inboxTabs.getByText('Noise', { exact: true }).click();
      await expectRows(page, [sale]);
      await page.keyboard.press('1');
      did('AL-006', 'F-029');
      await checked('Signal');
      await expectRows(page, [lunch]);
    });
  });

  test.describe(`the tabs of ${anInbox(provider)} on a phone`, () => {
    test.use({ ...PHONE, provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a pill of the phone's tab row does not open its tab:
    // Noise, All, Spam or Shared lists what another tab holds, or nothing.
    test('each pill opens its tab', async ({ page, mailbox }) => {
      await deliverNoise(mailbox, {
        from: 'Deals <deals@example.com>',
        subject: 'Sale',
        text: 'Everything must go.',
      });
      await deliverToSpam(mailbox, {
        from: 'Hal <hal@example.com>',
        subject: 'Team photos',
        text: 'The photos from Friday.',
      });
      await mailbox.deliver({ from: GRACE, subject: 'Lunch?', text: 'Noon?' });
      const lunch = (await mailbox.synced('Lunch?')).id;
      const sale = (await mailbox.synced('Sale')).id;
      const photos = await syncedInView(mailbox, 'spam', 'Team photos');
      const pill = (name: string) =>
        page.getByRole('button', { name, exact: true });

      await mailbox.open();
      expect(await page.evaluate(() => window.innerWidth)).toBe(
        PHONE.viewport.width
      );
      await expectRows(page, [lunch]);

      await pill('Noise').tap();
      did('AL-004', 'F-029');
      await expect(pill('Noise')).toHaveAttribute('aria-pressed', 'true');
      await expectRows(page, [sale]);

      await pill('All').tap();
      did('AL-004', 'F-030');
      await expect(pill('All')).toHaveAttribute('aria-pressed', 'true');
      await expectRows(page, [lunch, sale]);

      await pill('Spam').tap();
      did('AL-004', 'F-031');
      await expect(pill('Spam')).toHaveAttribute('aria-pressed', 'true');
      await expectRows(page, [photos]);
      // What the tab lists is what the provider holds as spam.
      expect(
        (await mailbox.providerMessages())
          .filter((message) => message.labels.includes(spamFolder(provider)))
          .map((message) => message.subject)
      ).toEqual(['Team photos']);
      confirmed('F-031');

      // Shared asks the service for the threads other people shared: none.
      const shared = page.waitForResponse((response) =>
        listQuery(response.request(), '"shared":"ONLY"')
      );
      await pill('Shared').tap();
      did('AL-004', 'F-032');
      await expect(pill('Shared')).toHaveAttribute('aria-pressed', 'true');
      const listed = (await (await shared).json()) as {
        data: { user: { soup: { items: unknown[] } } };
      };
      expect(listed.data.user.soup.items).toEqual([]);
      confirmed('F-032');
      await expectRows(page, []);

      await pill('Signal').tap();
      await expectRows(page, [lunch]);
    });
  });
}

// Gmail only: where the breadcrumb leads does not depend on the mailbox.
test.describe('the list breadcrumb, in a Gmail inbox', () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, the breadcrumb's name at the list opens no menu of
  // views, or the view picked there does not open. (The name never shows
  // beside an open thread on a desktop: with the reading pane the header
  // shows the tab alone, and without it the thread replaces the header.)
  test('the breadcrumb name opens the view menu, and the view picked there opens', async ({
    page,
    mailbox,
  }) => {
    await mailbox.deliver({ from: GRACE, subject: 'Lunch?', text: 'Noon?' });
    const lunch = (await mailbox.synced('Lunch?')).id;

    await mailbox.open();
    await expectRows(page, [lunch]);
    await expect(
      page.getByRole('button', { name: 'Show reading pane' })
    ).toHaveAttribute('aria-pressed', 'false');
    expect(openThreadId(page)).toBeUndefined();

    await page
      .getByRole('navigation', { name: 'Email location' })
      .getByRole('button', { name: 'Inbox', exact: true })
      .click();
    did('AL-104');
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Email' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    await menu.getByRole('menuitem', { name: 'Tasks' }).click();
    await expect(page).toHaveURL(/\/app\/tasks/);
    await expect(
      page.getByRole('complementary', { name: 'Tasks navigation' })
    ).toBeVisible();
    await expect(page.getByRole('grid', { name: 'Email' })).toHaveCount(0);
  });
});

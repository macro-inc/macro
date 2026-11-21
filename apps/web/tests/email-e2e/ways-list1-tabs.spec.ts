// The other ways to the tabs of the mail list: the sidebar's Inbox item, Tab,
// Shift+Tab and the number keys over the Inbox tabs, and on a phone the Inbox
// pills and the sidebar's sheet, each for a Gmail and an Outlook inbox; and
// the header breadcrumb's name.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { deliverToSpam, spamFolder, syncedInView } from './harness/journeys';
import { deliverNoise, openThreadId } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import {
  expectRows,
  GRACE,
  listQuery,
  openSidebarSheet,
  PHONE,
  sidebarSheet,
  touchHeaderName,
} from './harness/ways-list1';
import { confirmed, did, saw } from './ledger/record';

for (const provider of PROVIDERS) {
  test.describe(`the other ways to the tabs of ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, one of the desktop's other ways to a tab is dead or
    // opens the wrong tab: Tab or Shift+Tab between the Inbox tabs, their
    // number keys, or the sidebar's Inbox item; or Tab still switches tabs
    // from a control, where it should move focus.
    test('Tab, the number keys and the sidebar Inbox item each open their tab', async ({
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
      const list = page.getByRole('grid', { name: 'Email' });

      await mailbox.open();
      await expectRows(page, [lunch]);

      // With the keyboard on the list, Tab walks the Inbox tabs, Signal to
      // Noise, and Shift+Tab back.
      await list.focus();
      await page.keyboard.press('Tab');
      did('AL-007');
      await checked('Noise');
      await expectRows(page, [sale]);
      await page.keyboard.press('Shift+Tab');
      await checked('Signal');
      await expectRows(page, [lunch]);

      // The number keys pick the Inbox tabs by position (Focus, when it
      // shows, comes first).
      const names = await inboxTabs
        .getByRole('radio')
        .evaluateAll((radios) =>
          radios.map(
            (radio) =>
              radio.closest('[role="group"]')?.textContent?.trim() ?? ''
          )
        );
      const key = (name: string) => String(names.indexOf(name) + 1);
      await list.focus();
      await page.keyboard.press(key('Noise'));
      did('AL-006', 'F-029');
      await checked('Noise');
      await expectRows(page, [sale]);
      await page.keyboard.press(key('Signal'));
      await checked('Signal');
      await expectRows(page, [lunch]);

      // The sidebar's Inbox item leads back to Signal; on that button, Tab
      // moves focus and leaves the tab alone.
      await inboxTabs.getByText('Noise', { exact: true }).click();
      await expectRows(page, [sale]);
      const inboxItem = page
        .getByRole('navigation', { name: 'Email tabs' })
        .getByRole('button', { name: 'Inbox' });
      await inboxItem.click();
      did('AL-001');
      await checked('Signal');
      await expectRows(page, [lunch]);
      await inboxItem.focus();
      await page.keyboard.press('Tab');
      await expect(inboxItem).not.toBeFocused();
      await checked('Signal');
      await expectRows(page, [lunch]);
    });
  });

  test.describe(`the tabs of ${anInbox(provider)} on a phone`, () => {
    test.use({ ...PHONE, provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a pill of the phone's Inbox row or a tab of its
    // sidebar sheet does not open its tab (Noise, All, Spam or Shared lists
    // what another tab holds, or nothing), the sheet stays open over the
    // list, or the header does not name the tab chosen there.
    test('the Noise pill and each tab of the sidebar sheet open their tab', async ({
      page,
      mailbox,
    }) => {
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
      // The header's pills, not the sheet's tabs of the same names.
      const pill = (name: string) =>
        page.getByRole('main').getByRole('button', { name, exact: true });
      const sheet = sidebarSheet(page);
      const sheetTab = (name: string) =>
        sheet
          .getByRole('navigation', { name: 'Email tabs' })
          .getByRole('button', { name, exact: true });

      await mailbox.open();
      expect(await page.evaluate(() => window.innerWidth)).toBe(
        PHONE.viewport.width
      );
      await expectRows(page, [lunch]);

      await pill('Noise').tap();
      did('AL-004');
      await expect(pill('Noise')).toHaveAttribute('aria-pressed', 'true');
      await expectRows(page, [sale]);

      // The other tabs are in the sidebar's sheet, which closes on the
      // choice; the header then names the tab in place of the pills.
      await openSidebarSheet(page);
      await sheetTab('All').tap();
      did('AL-002', 'F-030');
      await expect(sheet).toHaveCount(0);
      await expect(touchHeaderName(page, 'All')).toBeVisible();
      await expect(pill('Signal')).toHaveCount(0);
      saw('STL-989');
      await expectRows(page, [lunch, sale]);
      saw('STL-923');

      await openSidebarSheet(page);
      await sheetTab('Spam').tap();
      did('AL-002', 'F-031');
      await expect(touchHeaderName(page, 'Spam')).toBeVisible();
      await expectRows(page, [photos]);
      // What the tab lists is what the provider holds as spam.
      expect(
        (await mailbox.providerMessages())
          .filter((message) => message.labels.includes(spamFolder(provider)))
          .map((message) => message.subject)
      ).toEqual(['Team photos']);
      confirmed('F-031');
      saw('STL-924');

      // Shared asks the service for the threads other people shared: none.
      const shared = page.waitForResponse((response) =>
        listQuery(response.request(), '"shared":"ONLY"')
      );
      await openSidebarSheet(page);
      await sheetTab('Shared').tap();
      did('AL-002', 'F-032');
      await expect(touchHeaderName(page, 'Shared')).toBeVisible();
      const listed = (await (await shared).json()) as {
        data: { user: { soup: { items: unknown[] } } };
      };
      expect(listed.data.user.soup.items).toEqual([]);
      confirmed('F-032');
      await expectRows(page, []);

      await openSidebarSheet(page);
      await sheetTab('Signal').tap();
      await expect(sheet).toHaveCount(0);
      await expect(pill('Signal')).toHaveAttribute('aria-pressed', 'true');
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

// The other ways to fill the recipient rows of a new message: a comma or a
// semicolon, Tab on a suggestion, a chip's X, Escape, the hotkeys that go to
// To, Cc and Bcc, and the two ways to ask for more suggestions.

import { body, loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import {
  addContacts,
  chip,
  named,
  openComposer,
  PROVIDERS,
  recipientInput,
  sentCopy,
} from './harness/ways-compose1';
import { did } from './ledger/record';

const suggestions = (page: import('@playwright/test').Page) =>
  page.getByRole('listbox', { name: 'Suggestions' });

for (const provider of PROVIDERS) {
  test.describe(`the recipient rows of a new message, ${named(provider)} inbox`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, one of the keyboard ways to name a recipient stopped
    // working (a comma or semicolon, Tab on a suggestion, the hotkey to To,
    // Cc or Bcc), a chip's X no longer removes its recipient, or Escape no
    // longer backs out of a half-typed name: the message goes to the wrong
    // people.
    test('addresses added by separator, Tab and hotkey are the ones the message goes to', async ({
      page,
      mailbox,
    }) => {
      await addContacts(mailbox, ['grace@example.com', 'hugo@example.com']);
      const to = await openComposer(page, mailbox);

      await to.pressSequentially('zed@example.com,');
      did('AC-002');
      await expect(chip(page, 'zed@example.com')).toBeVisible();
      await expect(to).toHaveValue('');
      // Several at once, as a paste brings them.
      await to.fill('ida@example.com; bob@example.com;');
      await expect(chip(page, 'ida@example.com')).toBeVisible();
      await expect(chip(page, 'bob@example.com')).toBeVisible();

      // The pointer rests where an earlier click left it; over the list it
      // would take the highlight away from the keyboard.
      await page.mouse.move(0, 0);
      await to.pressSequentially('grac');
      // Tab takes the highlighted suggestion. A suggestion that arrives
      // after the last keystroke is not highlighted until a key moves to
      // it, so the arrow key does, as a person would.
      const grace = suggestions(page)
        .getByRole('option')
        .filter({ hasText: 'grace@' });
      await expect(grace).toBeVisible();
      await to.press('ArrowDown');
      await expect(grace).toHaveAttribute('data-highlighted');
      await to.press('Tab');
      did('AC-004');
      await expect(chip(page, 'grace@example.com')).toBeVisible();

      await chip(page, 'bob@example.com').locator('svg').last().click();
      did('AC-006');
      await expect(chip(page, 'bob@example.com')).toHaveCount(0);

      // Escape, three times: the menu, the typed text, the field.
      await to.pressSequentially('hug');
      await expect(suggestions(page)).toBeVisible();
      await to.press('Escape');
      did('AC-009');
      await expect(suggestions(page)).toHaveCount(0);
      await expect(to).toHaveValue('hug');
      await expect(to).toBeFocused();
      await to.press('Escape');
      await expect(to).toHaveValue('');
      await expect(to).toBeFocused();
      await to.press('Escape');
      await expect(to).not.toBeFocused();

      const subject = page.getByPlaceholder(/subject/i);
      await subject.fill('Who is coming');
      await page.keyboard.press('ControlOrMeta+Shift+KeyO');
      did('AC-015');
      await expect(to).toBeFocused();
      await page.keyboard.type('kim@example.com');
      await page.keyboard.press('Enter');

      await page.keyboard.press('ControlOrMeta+Shift+KeyC');
      did('AC-302');
      await expect(recipientInput(page, 'Cc')).toBeFocused();
      await page.keyboard.type('lou@example.com');
      await page.keyboard.press('Enter');

      await page.keyboard.press('ControlOrMeta+Shift+KeyB');
      did('AC-303');
      await expect(recipientInput(page, 'Bcc')).toBeFocused();
      await page.keyboard.type('max@example.com');
      await page.keyboard.press('Enter');

      await body(page).click();
      await page.keyboard.type('Tell me by Friday.');
      await page.getByRole('button', { name: 'Send email' }).click();

      const sent = await sentCopy(mailbox, 'Who is coming');
      expect([...sent.to].sort()).toEqual([
        'grace@example.com',
        'ida@example.com',
        'kim@example.com',
        'zed@example.com',
      ]);
      expect(sent.cc).toEqual(['lou@example.com']);
      expect(sent.bcc).toEqual(['max@example.com']);
    });
  });
}

// Gmail only: the suggestions come from the user's contacts, which no
// mailbox has a part in.
test.describe('more suggestions than one window holds', () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, a person beyond the first fifty matches cannot be
  // reached from the recipient field: PageDown, ArrowDown past the last
  // suggestion or the Next options button no longer brings the next window.
  test('PageDown, ArrowDown on the last one and Next options each bring the next window', async ({
    page,
    mailbox,
  }) => {
    const pals = Array.from(
      { length: 160 },
      (_, index) => `pal${String(index + 1).padStart(3, '0')}@example.com`
    );
    await addContacts(mailbox, pals);
    const to = await openComposer(page, mailbox);
    const options = suggestions(page).getByRole('option');
    const next = page.getByRole('button', { name: 'Next options' });
    const shown = async () => {
      const texts = await options.allTextContents();
      return pals.filter((pal) => texts.some((text) => text.includes(pal)));
    };

    await to.pressSequentially('pal');
    await expect(next).toBeVisible();
    const first = await shown();
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThan(pals.length);

    const ways = [
      {
        row: 'AC-008',
        ask: () => to.press('PageDown'),
      },
      {
        row: 'AC-008',
        ask: async () => {
          await to.press('End');
          await to.press('ArrowDown');
        },
      },
      {
        row: 'AC-317',
        ask: () => next.click(),
      },
    ] as const;
    let before = first;
    for (const way of ways) {
      await way.ask();
      did(way.row);
      // A window of people not shown before.
      await expect
        .poll(async () => {
          const now = await shown();
          return now.length > 0 && now.every((pal) => !before.includes(pal));
        })
        .toBe(true);
      before = [...before, ...(await shown())];
    }
    await expect(to).toBeFocused();
    await expect(to).toHaveValue('pal');
  });
});

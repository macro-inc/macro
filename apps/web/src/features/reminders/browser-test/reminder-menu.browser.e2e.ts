import { expect, type Page, test } from '@playwright/test';

const fixture = '/src/features/reminders/browser-test/reminder-menu.html';

async function openMenu(page: Page) {
  // Friday, November 6, 2026, 10am in New York.
  await page.clock.setFixedTime(new Date('2026-11-06T15:00:00Z'));
  await page.goto(fixture);
  const input = page.getByRole('combobox', { name: 'Remind me when' });
  await expect(input).toBeVisible({ timeout: 30_000 });
  return input;
}

test('previews a guessed hour both ways and saves the guess', async ({
  page,
  isMobile,
}) => {
  const input = await openMenu(page);
  await input.fill('next thurs at 3');

  const options = page.getByRole('option', { name: /^next thurs at 3/ });
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toContainText(
    'Nov 12, 2026 at 3:00 PM · PM assumed'
  );
  await expect(options.nth(1)).toContainText('Nov 12, 2026 at 3:00 AM');

  if (isMobile) await options.nth(0).tap();
  else await input.press('Enter');
  await expect(page.getByTestId('saved')).toHaveText(
    '2026-11-12T20:00:00.000Z if_no_reply'
  );
});

test('the other half of the day is one step down', async ({ page }) => {
  const input = await openMenu(page);
  await input.fill('tmrw at 9');
  await expect(
    page.getByRole('option', { name: /^tmrw at 9/ }).nth(1)
  ).toContainText('Nov 7, 2026 at 9:00 PM');

  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(page.getByTestId('saved')).toHaveText(
    '2026-11-08T02:00:00.000Z if_no_reply'
  );
});

test('explains a phrase it cannot read and saves nothing', async ({ page }) => {
  const input = await openMenu(page);
  for (const [phrase, reason] of [
    ['every friday', 'Repeating reminders aren’t supported.'],
    ['yesterday at 5pm', 'That time has passed.'],
    ['mar 14 2027 at 2:30am', 'Daylight saving time skips that time.'],
  ]) {
    await input.fill(phrase);
    await expect(page.getByText(reason)).toBeVisible();
    await expect(page.getByRole('option')).toHaveCount(0);
    await input.press('Enter');
  }
  await expect(page.getByTestId('saved')).toHaveText('');
});

test('presets still show and save before anything is typed', async ({
  page,
}) => {
  const input = await openMenu(page);
  await expect(page.getByRole('option')).toHaveText([
    /^In 30m/,
    /^Later today/,
    /^Tomorrow/,
    /^Next week/,
  ]);
  await input.press('Enter');
  await expect(page.getByTestId('saved')).toHaveText(
    '2026-11-06T15:30:00.000Z if_no_reply'
  );
});

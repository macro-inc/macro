import { expect, type Page, test } from '@playwright/test';

declare global {
  interface Window {
    tonesPlayed: number;
  }
}

/** Counts scheduled tones, so a test can tell which sound played. */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.tonesPlayed = 0;
    const createOscillator = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (this: AudioContext) {
      window.tonesPlayed += 1;
      return createOscillator.call(this);
    };
  });
  await page.goto('/');
});

const tonesPlayed = (page: Page) => page.evaluate(() => window.tonesPlayed);

/** Switch inputs are visually hidden behind their track, so use the keyboard. */
async function toggle(page: Page, name: string) {
  const control = page.getByRole('switch', { name, exact: true });
  await control.focus();
  await control.press('Space');
}

test('sounds stay off until turned on, then reveal per-type choices', async ({
  page,
}) => {
  const master = page.getByRole('switch', { name: 'Notification sounds' });
  await expect(master).not.toBeChecked();
  await expect(page.getByText('Thread replies')).toHaveCount(0);

  await page.evaluate(() => window.deliverNotification('channel_mention'));
  expect(await tonesPlayed(page)).toBe(0);

  await toggle(page, 'Notification sounds');
  await expect(page.getByRole('slider', { name: 'Volume' })).toBeVisible();
  for (const label of ['Messages', 'Mentions', 'Email', 'Meetings & reminders'])
    await expect(
      page.getByRole('switch', { name: label, exact: true })
    ).toBeVisible();
  await expect(
    page.getByRole('switch', { name: 'Email', exact: true })
  ).not.toBeChecked();
  await expect(
    page.getByRole('switch', { name: 'Mentions', exact: true })
  ).toBeChecked();
});

test('choosing a sound previews it, persists, and plays for that type', async ({
  page,
}) => {
  await toggle(page, 'Notification sounds');

  await page.getByRole('button', { name: /^Mentions sound/ }).click();
  await page.getByRole('option', { name: 'Bloom' }).click();
  // Bloom is a four-note arpeggio.
  await expect.poll(() => tonesPlayed(page)).toBe(4);

  await page.reload();
  await expect(
    page.getByRole('switch', { name: 'Notification sounds' })
  ).toBeChecked();
  await expect(
    page.getByRole('button', { name: /^Mentions sound/ })
  ).toContainText('Bloom');

  // A gesture lets the reloaded page start audio, as a real person would.
  await page.getByRole('heading', { name: 'Notifications' }).click();
  // Email is off by default. Had it played, the burst limit would have
  // swallowed the mention's four-note sound.
  await page.evaluate(() => {
    window.deliverNotification('new_email');
    window.deliverNotification('channel_mention');
  });
  await expect.poll(() => tonesPlayed(page)).toBe(4);
});

test('play buttons preview each type and a muted type stays quiet', async ({
  page,
}) => {
  await toggle(page, 'Notification sounds');
  await page
    .getByRole('button', { name: 'Play Meetings & reminders sound' })
    .click();
  // Chime is two notes.
  await expect.poll(() => tonesPlayed(page)).toBe(2);

  await toggle(page, 'Meetings & reminders');
  // A reply plays the one-note Pop. Had the muted reminder played, the burst
  // limit would have swallowed the reply instead.
  await page.evaluate(() => {
    window.deliverNotification('calendar_event_reminder');
    window.deliverNotification('channel_message_reply');
  });
  await expect.poll(() => tonesPlayed(page)).toBe(3);
});

import { expect, type Page, test } from '@playwright/test';
import { notificationSound } from '../core/sounds';

declare global {
  interface Window {
    tonesPlayed: number;
    audioContexts: AudioContext[];
  }
}

/**
 * Counts scheduled tones, so a test can tell which sound played, and keeps
 * every audio context the page creates.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.tonesPlayed = 0;
    window.audioContexts = [];
    const createOscillator = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (this: AudioContext) {
      window.tonesPlayed += 1;
      return createOscillator.call(this);
    };
    const NativeAudioContext = AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        window.audioContexts.push(this);
      }
    };
  });
  await page.goto('/');
});

const tonesPlayed = (page: Page) => page.evaluate(() => window.tonesPlayed);
const contextStates = (page: Page) =>
  page.evaluate(() => window.audioContexts.map((context) => context.state));

/** Hides or shows the page as switching apps or tabs would. */
async function setVisibility(page: Page, state: 'hidden' | 'visible') {
  await page.evaluate((state) => {
    Object.defineProperty(document, 'visibilityState', {
      value: state,
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

const tap = (page: Page) =>
  page.getByRole('heading', { name: 'Notifications' }).click();

/** Switch inputs are visually hidden behind their track, so use the keyboard. */
async function toggle(page: Page, name: string) {
  const control = page.getByRole('switch', { name, exact: true });
  await control.focus();
  await control.press('Space');
}

test('call cues default on, preview independently, and persist their own switch', async ({
  page,
}) => {
  const joinTones = notificationSound('call-join').tones.length;
  const leaveTones = notificationSound('call-leave').tones.length;
  await expect(
    page.getByRole('switch', { name: 'Call sounds', exact: true })
  ).toBeChecked();
  await expect(
    page.getByRole('switch', { name: 'Notification sounds', exact: true })
  ).not.toBeChecked();
  await expect(page.getByRole('slider', { name: 'Volume' })).toBeVisible();
  await page.getByRole('button', { name: 'Preview join', exact: true }).click();
  await expect.poll(() => tonesPlayed(page)).toBe(joinTones);
  await page
    .getByRole('button', { name: 'Preview leave', exact: true })
    .click();
  await expect.poll(() => tonesPlayed(page)).toBe(joinTones + leaveTones);
  await toggle(page, 'Call sounds');
  await expect(page.getByRole('slider', { name: 'Volume' })).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('switch', { name: 'Call sounds', exact: true })
  ).not.toBeChecked();
  await page.getByRole('button', { name: 'Preview join', exact: true }).click();
  await expect.poll(() => tonesPlayed(page)).toBe(joinTones);
});

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

test('quiet hours persist and silence sounds without stopping a preview', async ({
  page,
}) => {
  const quiet = page.getByRole('switch', { name: 'Quiet hours' });
  await expect(quiet).not.toBeChecked();
  await expect(page.getByRole('group', { name: 'Days' })).toHaveCount(0);

  await toggle(page, 'Quiet hours');
  await expect(page.getByRole('button', { name: 'Monday' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await page.getByRole('button', { name: 'Saturday' }).click();
  await expect(page.getByRole('button', { name: 'Saturday' })).toHaveAttribute(
    'aria-pressed',
    'false'
  );

  await page.reload();
  await expect(quiet).toBeChecked();
  await expect(page.getByRole('button', { name: 'Saturday' })).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  await expect(page.getByRole('button', { name: 'Monday' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );

  await page.evaluate(() => {
    const key = 'macro:notification-sounds:fixture-user';
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}') as {
      enabled?: boolean;
      quietHours?: {
        enabled?: boolean;
        startMinutes?: number;
        endMinutes?: number;
        days?: string[];
        timeZone?: string;
      };
    };
    const now = new Date();
    const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    saved.enabled = true;
    saved.quietHours = {
      ...saved.quietHours,
      enabled: true,
      startMinutes: (minutes + 1440 - 30) % 1440,
      endMinutes: (minutes + 30) % 1440,
      days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      timeZone: 'UTC',
    };
    localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  await page.getByRole('heading', { name: 'Notifications' }).click();
  await page.evaluate(() => window.deliverNotification('channel_mention'));
  expect(await tonesPlayed(page)).toBe(0);
  await page.getByRole('button', { name: 'Play Mentions sound' }).click();
  await expect.poll(() => tonesPlayed(page)).toBe(2);
});

test('taps start no audio while sounds are off and no call is running', async ({
  page,
}) => {
  await tap(page);
  await page.keyboard.press('Enter');
  await tap(page);
  expect(await contextStates(page)).toEqual([]);
});

test('turning sounds on starts audio within that tap, and hiding the page suspends it', async ({
  page,
}) => {
  await toggle(page, 'Notification sounds');
  await expect.poll(() => contextStates(page)).toEqual(['running']);
  await page.evaluate(() => window.deliverNotification('channel_mention'));
  await expect.poll(() => tonesPlayed(page)).toBe(2);

  await setVisibility(page, 'hidden');
  await expect.poll(() => contextStates(page)).toEqual(['suspended']);

  // A sound arriving while hidden plays, then lets the context suspend again.
  await page.waitForTimeout(1_600);
  await page.evaluate(() => window.deliverNotification('channel_mention'));
  await expect.poll(() => tonesPlayed(page)).toBe(4);
  await expect.poll(() => contextStates(page)).toEqual(['suspended']);

  // Back in view, the next tap resumes it.
  await setVisibility(page, 'visible');
  expect(await contextStates(page)).toEqual(['suspended']);
  await tap(page);
  await expect.poll(() => contextStates(page)).toEqual(['running']);

  await toggle(page, 'Notification sounds');
  await expect.poll(() => contextStates(page)).toEqual(['suspended']);
  await tap(page);
  expect(await contextStates(page)).toEqual(['suspended']);
});

test('a preview with sounds off plays, then lets audio suspend', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Preview join', exact: true }).click();
  await expect
    .poll(() => tonesPlayed(page))
    .toBe(notificationSound('call-join').tones.length);
  await expect.poll(() => contextStates(page)).toEqual(['suspended']);
});

test('call audio starts only while a call runs and plays its chimes', async ({
  page,
}) => {
  await tap(page);
  expect(await contextStates(page)).toEqual([]);

  await page.evaluate(() => window.setCallActive(true));
  await tap(page);
  await expect.poll(() => contextStates(page)).toEqual(['running']);
  await page.evaluate(() => window.playCallSound('join'));
  await expect
    .poll(() => tonesPlayed(page))
    .toBe(notificationSound('call-join').tones.length);

  // The leave chime plays as the call ends, then audio suspends.
  await page.evaluate(() => {
    window.playCallSound('leave');
    window.setCallActive(false);
  });
  await expect
    .poll(() => tonesPlayed(page))
    .toBe(
      notificationSound('call-join').tones.length +
        notificationSound('call-leave').tones.length
    );
  await expect.poll(() => contextStates(page)).toEqual(['suspended']);
  await tap(page);
  expect(await contextStates(page)).toEqual(['suspended']);
});

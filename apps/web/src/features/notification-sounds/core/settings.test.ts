import { expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_SOUND_SETTINGS,
  parseNotificationSoundSettings,
  soundForNotification,
} from './settings';

it('keeps sounds off until they are turned on', () => {
  expect(parseNotificationSoundSettings(null).enabled).toBe(false);
  expect(
    soundForNotification('channel_mention', DEFAULT_NOTIFICATION_SOUND_SETTINGS)
  ).toBeNull();
});

it('falls back to defaults for unreadable storage', () => {
  expect(parseNotificationSoundSettings('{not json')).toEqual(
    DEFAULT_NOTIFICATION_SOUND_SETTINGS
  );
  expect(parseNotificationSoundSettings('{"volume":4}')).toEqual(
    DEFAULT_NOTIFICATION_SOUND_SETTINGS
  );
});

it('keeps valid saved choices and defaults unknown sounds and categories', () => {
  const settings = parseNotificationSoundSettings(
    JSON.stringify({
      enabled: true,
      volume: 0.4,
      categories: {
        email: { enabled: true, sound: 'chime' },
        mentions: { enabled: false, sound: 'removed-sound' },
        retired_category: { enabled: true, sound: 'ding' },
      },
    })
  );

  expect(settings.enabled).toBe(true);
  expect(settings.volume).toBe(0.4);
  expect(settings.categories.email).toEqual({ enabled: true, sound: 'chime' });
  expect(settings.categories.mentions).toEqual({
    enabled: false,
    sound: DEFAULT_NOTIFICATION_SOUND_SETTINGS.categories.mentions.sound,
  });
  expect(settings.categories.messages).toEqual(
    DEFAULT_NOTIFICATION_SOUND_SETTINGS.categories.messages
  );
});

it('plays the sound chosen for the notification category', () => {
  const settings = parseNotificationSoundSettings(
    JSON.stringify({
      enabled: true,
      categories: {
        mentions: { enabled: true, sound: 'bloom' },
        email: { enabled: false, sound: 'chime' },
      },
    })
  );

  expect(soundForNotification('channel_mention', settings)).toBe('bloom');
  expect(soundForNotification('mentioned_in_document_comment', settings)).toBe(
    'bloom'
  );
  expect(soundForNotification('new_email', settings)).toBeNull();
});

it('stays quiet for calls, muted volume, and unknown events', () => {
  const settings = parseNotificationSoundSettings(
    JSON.stringify({ enabled: true })
  );

  expect(soundForNotification('call_started', settings)).toBeNull();
  expect(soundForNotification('event_from_a_newer_backend', settings)).toBe(
    null
  );
  expect(
    soundForNotification('channel_mention', { ...settings, volume: 0 })
  ).toBeNull();
});

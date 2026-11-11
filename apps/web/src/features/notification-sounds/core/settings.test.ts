import { expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_SOUND_SETTINGS,
  parseNotificationSoundSettings,
  soundForCallEvent,
  soundForNotification,
} from './settings';
import { notificationSound } from './sounds';

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

it('defaults call sounds on for legacy storage without changing notification sounds', () => {
  const settings = parseNotificationSoundSettings('{"enabled":false}');

  expect(settings.callSoundsEnabled).toBe(true);
  expect(soundForCallEvent('join', settings)).toBe('call-join');
  expect(soundForCallEvent('leave', settings)).toBe('call-leave');
  expect(soundForNotification('channel_mention', settings)).toBeNull();
});

it('synthesizes short rising and falling two-note chimes', () => {
  const join = notificationSound('call-join').tones;
  const leave = notificationSound('call-leave').tones;
  const joinNotes = join.filter((tone) => tone.gain >= 0.8);
  const leaveNotes = leave.filter((tone) => tone.gain >= 0.8);

  expect(joinNotes).toHaveLength(2);
  expect(leaveNotes).toHaveLength(2);
  expect(joinNotes[1].start).toBeGreaterThan(joinNotes[0].start);
  expect(joinNotes[1].frequency).toBeGreaterThan(joinNotes[0].frequency);
  expect(leaveNotes[1].start).toBeGreaterThan(leaveNotes[0].start);
  expect(leaveNotes[1].frequency).toBeLessThan(leaveNotes[0].frequency);
  for (const tone of [...join, ...leave]) {
    expect(tone.wave).toBe('sine');
    expect(tone.glideTo).toBeUndefined();
    expect(tone.start + tone.duration).toBeLessThan(0.5);
  }
});

it('silences call sounds when disabled, muted, or within quiet hours', () => {
  const settings = parseNotificationSoundSettings(
    JSON.stringify({
      enabled: true,
      callSoundsEnabled: false,
      quietHours: {
        enabled: true,
        startMinutes: 22 * 60,
        endMinutes: 8 * 60,
        days: ['tue'],
        timeZone: 'UTC',
      },
    })
  );
  const noon = new Date('2026-11-03T12:00:00Z');
  const night = new Date('2026-11-03T23:30:00Z');

  expect(soundForCallEvent('join', settings, noon)).toBeNull();
  expect(
    soundForCallEvent('leave', { ...settings, callSoundsEnabled: true }, night)
  ).toBeNull();
  expect(
    soundForCallEvent(
      'join',
      { ...settings, callSoundsEnabled: true, volume: 0 },
      noon
    )
  ).toBeNull();
  expect(
    soundForCallEvent('leave', { ...settings, callSoundsEnabled: true }, noon)
  ).toBe('call-leave');
  expect(soundForNotification('channel_mention', settings, noon)).toBe('ding');
});

it('plays the sound chosen for the notification category', () => {
  const settings = parseNotificationSoundSettings(
    JSON.stringify({
      enabled: true,
      categories: {
        mentions: { enabled: true, sound: 'bloom' },
        email: { enabled: false, sound: 'chime' },
        other: { enabled: true, sound: 'pluck' },
      },
    })
  );

  expect(soundForNotification('channel_mention', settings)).toBe('bloom');
  expect(soundForNotification('mentioned_in_document_comment', settings)).toBe(
    'bloom'
  );
  expect(soundForNotification('new_email', settings)).toBeNull();
  expect(soundForNotification('channel_access_requested', settings)).toBe(
    'pluck'
  );
});

it('stays quiet during quiet hours and plays again outside them', () => {
  const settings = parseNotificationSoundSettings(
    JSON.stringify({
      enabled: true,
      quietHours: {
        enabled: true,
        startMinutes: 22 * 60,
        endMinutes: 8 * 60,
        days: ['tue'],
        timeZone: 'UTC',
      },
    })
  );

  expect(
    soundForNotification(
      'channel_mention',
      settings,
      new Date('2026-11-03T23:30:00Z')
    )
  ).toBeNull();
  expect(
    soundForNotification(
      'channel_mention',
      settings,
      new Date('2026-11-03T12:00:00Z')
    )
  ).toBe('ding');
  expect(parseNotificationSoundSettings('{"enabled":true}').quietHours).toEqual(
    DEFAULT_NOTIFICATION_SOUND_SETTINGS.quietHours
  );
});

it('stays quiet for calls, muted volume, and unknown events', () => {
  const settings = parseNotificationSoundSettings(
    JSON.stringify({ enabled: true })
  );

  expect(soundForNotification('call_started', settings)).toBeNull();
  expect(soundForNotification('channel_access_requested', settings)).toBeNull();
  expect(soundForNotification('event_from_a_newer_backend', settings)).toBe(
    null
  );
  expect(
    soundForNotification('channel_mention', { ...settings, volume: 0 })
  ).toBeNull();
});

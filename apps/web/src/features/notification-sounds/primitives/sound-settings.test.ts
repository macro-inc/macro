import { createRoot } from 'solid-js';
import { expect, it } from 'vitest';
import {
  createNotificationSoundSettings,
  readNotificationSoundSettings,
} from './sound-settings';

it('persists call sound preference independently of notification sounds', () => {
  const userId = 'call-sounds-settings-test';
  localStorage.removeItem(`macro:notification-sounds:${userId}`);

  createRoot((dispose) => {
    const sounds = createNotificationSoundSettings(userId);
    expect(sounds.settings().callSoundsEnabled).toBe(true);
    sounds.setCallSoundsEnabled(false);
    expect(readNotificationSoundSettings(userId).callSoundsEnabled).toBe(false);
    expect(readNotificationSoundSettings(userId).enabled).toBe(false);
    dispose();
  });

  localStorage.removeItem(`macro:notification-sounds:${userId}`);
});

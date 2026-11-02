/**
 * Picks one tab to play notification sounds, so a notification open in
 * several tabs dings once. The tab the person last focused or touched plays:
 * it is the one they are using, and its recent gesture lets it start audio.
 */

const SOUND_TAB_KEY = 'macro:notification-sounds:tab';
const TAB_ID = crypto.randomUUID();

export function claimNotificationSoundTab(): void {
  try {
    localStorage.setItem(SOUND_TAB_KEY, TAB_ID);
  } catch {
    // Without storage every tab plays, as before any tab claims.
  }
}

export function isNotificationSoundTab(): boolean {
  try {
    const owner = localStorage.getItem(SOUND_TAB_KEY);
    return owner === null || owner === TAB_ID;
  } catch {
    return true;
  }
}

/**
 * Hands sound back to the other tabs when this one closes, so they don't stay
 * silent until one of them is focused.
 */
export function releaseNotificationSoundTab(): void {
  try {
    if (localStorage.getItem(SOUND_TAB_KEY) === TAB_ID) {
      localStorage.removeItem(SOUND_TAB_KEY);
    }
  } catch {
    // Without storage every tab plays already.
  }
}

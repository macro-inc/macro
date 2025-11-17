const SOUND_ENABLED_KEY = 'sound-effects-enabled';
const SOUND_VOLUME_KEY = 'sound-effects-volume';

const DEFAULT_ENABLED = true;
const DEFAULT_VOLUME = 0.5; // 50%

export function getSoundEffectsEnabled(): boolean {
  const stored = localStorage.getItem(SOUND_ENABLED_KEY);
  return stored === null ? DEFAULT_ENABLED : stored === 'true';
}

export function setSoundEffectsEnabled(enabled: boolean) {
  localStorage.setItem(SOUND_ENABLED_KEY, String(enabled));
  // Dispatch event to notify sound code of preference change
  window.dispatchEvent(new CustomEvent('sound-preference-changed'));
}

export function getSoundEffectsVolume(): number {
  const stored = localStorage.getItem(SOUND_VOLUME_KEY);
  if (stored === null) return DEFAULT_VOLUME;
  const volume = parseFloat(stored);
  // Clamp between 0 and 1
  return isNaN(volume) ? DEFAULT_VOLUME : Math.max(0, Math.min(1, volume));
}

export function setSoundEffectsVolume(volume: number) {
  // Clamp between 0 and 1
  const clampedVolume = Math.max(0, Math.min(1, volume));
  localStorage.setItem(SOUND_VOLUME_KEY, String(clampedVolume));
  // Dispatch event to notify sound code of preference change
  window.dispatchEvent(new CustomEvent('sound-preference-changed'));
}

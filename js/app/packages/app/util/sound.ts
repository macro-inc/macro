/**
 * Sound utility for playing UI sounds
 * Caches Audio objects to avoid reloading
 */

import { getSoundEffectsEnabled, getSoundEffectsVolume } from './soundSettings';

const soundCache = new Map<string, HTMLAudioElement>();
const _DEFAULT_VOLUME = 0.3;

// Update cached audio volumes when preference changes
if (typeof window !== 'undefined') {
  window.addEventListener('sound-preference-changed', () => {
    const newVolume = getSoundEffectsVolume();
    soundCache.forEach((audio) => {
      audio.volume = newVolume;
    });
  });
}

/**
 * Normalize BASE_URL to always end with a trailing slash
 */
function getBasePath(): string {
  const base = import.meta.env.BASE_URL;
  return base.endsWith('/') ? base : `${base}/`;
}

/**
 * Get the sound file path, trying .wav first, then .mp3
 * @param name - The name of the sound file (without extension)
 */
function _getSoundPath(name: string): string {
  // Try .wav first, then fallback to .mp3
  // This allows both formats to work seamlessly
  // Use BASE_URL to respect Vite's base path configuration
  const base = getBasePath();
  return `${base}sounds/${name}.wav`;
}

/**
 * Play a sound by name
 * @param name - The name of the sound file (without extension)
 * @param volume - Optional volume (0-1), defaults to user preference or 0.3
 */
export function playSound(name: string, volume?: number): void {
  // Check if sound effects are enabled
  if (!getSoundEffectsEnabled()) {
    return;
  }

  // Use user preference volume if not specified, otherwise use provided volume
  const finalVolume = volume ?? getSoundEffectsVolume();
  // Get or create audio element
  let audio = soundCache.get(name);

  if (!audio) {
    // Try .wav first, fallback to .mp3 if needed
    // Use BASE_URL to respect Vite's base path configuration
    const base = getBasePath();
    const wavPath = `${base}sounds/${name}.wav`;
    const mp3Path = `${base}sounds/${name}.mp3`;

    // Create audio element - try .wav first
    audio = new Audio(wavPath);
    audio.volume = finalVolume;
    audio.preload = 'auto';

    // Handle errors gracefully - try mp3 fallback if .wav fails
    const errorHandler = () => {
      // If .wav fails, try .mp3
      const fallbackAudio = new Audio(mp3Path);
      fallbackAudio.volume = finalVolume;
      fallbackAudio.preload = 'auto';

      fallbackAudio.addEventListener('error', () => {
        console.warn(
          `Failed to load sound: ${name} (tried both .wav and .mp3)`
        );
      });

      // Replace the cached audio with the fallback
      soundCache.set(name, fallbackAudio);
    };

    audio.addEventListener('error', errorHandler, { once: true });
    soundCache.set(name, audio);
  }

  // Reset to beginning and play
  audio.currentTime = 0;
  audio.volume = finalVolume;

  // Play with error handling
  audio.play().catch((error) => {
    // Ignore play() errors (e.g., user hasn't interacted with page yet)
    if (error.name !== 'NotAllowedError') {
      console.warn(`Failed to play sound: ${name}`, error);
    }
  });
}

/**
 * Preload a sound file
 * @param name - The name of the sound file (without extension)
 */
export function preloadSound(name: string): void {
  if (soundCache.has(name)) {
    return;
  }

  // Use BASE_URL to respect Vite's base path configuration
  const base = getBasePath();
  const audio = new Audio(`${base}sounds/${name}.wav`);
  audio.preload = 'auto';
  audio.addEventListener('error', () => {
    // Fallback to mp3
    const fallbackAudio = new Audio(`${base}sounds/${name}.mp3`);
    fallbackAudio.preload = 'auto';
    soundCache.set(name, fallbackAudio);
  });
  soundCache.set(name, audio);
}

/** Each bar represents 200ms; retain a bounded history independent of layout. */
export const VOLUME_INTERVAL_MS = 200;
export const MAX_VOLUME_SAMPLES = 512;

/** Fixed dB scale keeps historical heights comparable across loud/quiet speech. */
export function microphoneLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let power = 0;
  for (const sample of samples) power += sample * sample;
  const rms = Math.sqrt(power / samples.length);
  if (rms === 0) return 0;
  const decibels = 20 * Math.log10(rms);
  return Math.max(0, Math.min(1, (decibels + 60) / 48));
}

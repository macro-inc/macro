/** Requested sampling cadence; keep a bounded history even during long recordings. */
export const VOLUME_INTERVAL_MS = 200;
export const MAX_VOLUME_SAMPLES = 512;

/** Normalized 0..1 microphone level for one interval. */
export type VolumeLevel = number;

export function appendLevel(
  history: readonly VolumeLevel[],
  level: VolumeLevel
): readonly VolumeLevel[] {
  return [...history.slice(-(MAX_VOLUME_SAMPLES - 1)), level];
}

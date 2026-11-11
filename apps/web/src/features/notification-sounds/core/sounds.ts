/**
 * Notification sounds, synthesized with Web Audio so the app ships no audio
 * files. Each sound is a short list of tones scheduled from its start.
 */

export type NotificationSoundId =
  | 'ding'
  | 'chime'
  | 'pop'
  | 'knock'
  | 'pluck'
  | 'ping'
  | 'bloom';

export type CallSoundId = 'call-join' | 'call-leave';

export type NotificationTone = {
  /** Start frequency in Hz. */
  frequency: number;
  /** Frequency the tone glides to by its end, for swept sounds. */
  glideTo?: number;
  /** Offset from the sound's start, in seconds. */
  start: number;
  /** Time until the tone has decayed to silence, in seconds. */
  duration: number;
  /** Time to hold the attack peak before decay, in seconds. */
  hold?: number;
  /** Relative loudness, 0 to 1, before the volume setting applies. */
  gain: number;
  wave: OscillatorType;
};

export type NotificationSound = {
  id: NotificationSoundId | CallSoundId;
  label: string;
  /** Full-volume master gain; omitted sounds keep the notification level. */
  gain?: number;
  /** Final tone gain relative to its peak; omitted sounds decay to 0.0001. */
  decayRatio?: number;
  tones: readonly NotificationTone[];
};

export const NOTIFICATION_SOUNDS: readonly NotificationSound[] = [
  {
    id: 'ding',
    label: 'Ding',
    tones: [
      { frequency: 1318.5, start: 0, duration: 0.9, gain: 1, wave: 'sine' },
      { frequency: 2637, start: 0, duration: 0.35, gain: 0.25, wave: 'sine' },
    ],
  },
  {
    id: 'chime',
    label: 'Chime',
    tones: [
      { frequency: 880, start: 0, duration: 0.45, gain: 0.9, wave: 'sine' },
      {
        frequency: 1318.5,
        start: 0.12,
        duration: 0.7,
        gain: 0.9,
        wave: 'sine',
      },
    ],
  },
  {
    id: 'pop',
    label: 'Pop',
    tones: [
      {
        frequency: 480,
        glideTo: 1150,
        start: 0,
        duration: 0.09,
        gain: 1,
        wave: 'sine',
      },
    ],
  },
  {
    id: 'knock',
    label: 'Knock',
    tones: [
      { frequency: 196, start: 0, duration: 0.09, gain: 1, wave: 'triangle' },
      {
        frequency: 174.6,
        start: 0.13,
        duration: 0.09,
        gain: 0.85,
        wave: 'triangle',
      },
    ],
  },
  {
    id: 'pluck',
    label: 'Pluck',
    tones: [
      { frequency: 659.3, start: 0, duration: 0.25, gain: 1, wave: 'triangle' },
      {
        frequency: 987.8,
        start: 0.07,
        duration: 0.3,
        gain: 0.7,
        wave: 'triangle',
      },
    ],
  },
  {
    id: 'ping',
    label: 'Ping',
    tones: [
      { frequency: 1760, start: 0, duration: 0.35, gain: 0.75, wave: 'sine' },
    ],
  },
  {
    id: 'bloom',
    label: 'Bloom',
    tones: [523.25, 659.25, 783.99, 1046.5].map((frequency, index) => ({
      frequency,
      start: index * 0.06,
      duration: 0.4,
      gain: 0.7,
      wave: 'sine' as const,
    })),
  },
];

/**
 * Clear two-note chimes: rising on arrival and falling on departure.
 * The shared gain matches the audition pair's normalized -5.3 dBFS peak.
 */
export const CALL_SOUNDS: readonly NotificationSound[] = [
  {
    id: 'call-join',
    label: 'Call join',
    gain: 0.4966653521918195,
    decayRatio: 0.001,
    tones: [
      {
        frequency: 659.255,
        start: 0,
        duration: 0.24,
        hold: 0.018,
        gain: 0.85,
        wave: 'sine',
      },
      {
        frequency: 1318.51,
        start: 0,
        duration: 0.14,
        hold: 0.005,
        gain: 0.22,
        wave: 'sine',
      },
      {
        frequency: 1819.5438,
        start: 0,
        duration: 0.085,
        gain: 0.08,
        wave: 'sine',
      },
      {
        frequency: 987.767,
        start: 0.12,
        duration: 0.3,
        hold: 0.018,
        gain: 1,
        wave: 'sine',
      },
      {
        frequency: 1975.534,
        start: 0.12,
        duration: 0.17,
        hold: 0.005,
        gain: 0.19,
        wave: 'sine',
      },
    ],
  },
  {
    id: 'call-leave',
    label: 'Call leave',
    gain: 0.4966653521918195,
    decayRatio: 0.001,
    tones: [
      {
        frequency: 659.255,
        start: 0,
        duration: 0.24,
        hold: 0.018,
        gain: 0.85,
        wave: 'sine',
      },
      {
        frequency: 1318.51,
        start: 0,
        duration: 0.14,
        hold: 0.005,
        gain: 0.22,
        wave: 'sine',
      },
      {
        frequency: 1819.5438,
        start: 0,
        duration: 0.085,
        gain: 0.08,
        wave: 'sine',
      },
      {
        frequency: 493.883,
        start: 0.12,
        duration: 0.3,
        hold: 0.018,
        gain: 1,
        wave: 'sine',
      },
      {
        frequency: 987.766,
        start: 0.12,
        duration: 0.17,
        hold: 0.005,
        gain: 0.19,
        wave: 'sine',
      },
    ],
  },
];

export function isNotificationSoundId(
  value: unknown
): value is NotificationSoundId {
  return NOTIFICATION_SOUNDS.some((sound) => sound.id === value);
}

export function notificationSound(
  id: NotificationSoundId | CallSoundId
): NotificationSound {
  const sound =
    NOTIFICATION_SOUNDS.find((candidate) => candidate.id === id) ??
    CALL_SOUNDS.find((candidate) => candidate.id === id);
  if (!sound) throw new Error(`Unknown notification sound: ${id}`);
  return sound;
}

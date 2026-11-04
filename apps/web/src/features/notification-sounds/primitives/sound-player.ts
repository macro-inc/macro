import { type NotificationSoundId, notificationSound } from '../core/sounds';

/** Loudest a tone gets at full volume; notification sounds stay gentle. */
const MAX_GAIN = 0.3;
const ATTACK_S = 0.005;
/** Lead time so the first tone is never scheduled in the past. */
const START_DELAY_S = 0.01;

let sharedContext: AudioContext | undefined;

function audioContext(): AudioContext | undefined {
  if (sharedContext) return sharedContext;
  if (typeof AudioContext === 'undefined') return undefined;
  try {
    sharedContext = new AudioContext();
  } catch (error) {
    console.warn(
      'Could not create an AudioContext for notification sounds',
      error
    );
    return undefined;
  }
  return sharedContext;
}

/**
 * Resumes audio from inside a user gesture. iOS only lets a page start audio
 * during one, so a sound arriving later can play.
 */
export async function unlockNotificationSounds(): Promise<void> {
  const context = audioContext();
  if (context?.state === 'suspended') await context.resume();
}

/**
 * Plays a notification sound at `volume` (0 to 1). Browsers keep audio
 * suspended until the page has had a user gesture; a sound arriving before
 * any interaction stays silent instead of playing late once audio resumes.
 */
export async function playNotificationSound(
  id: NotificationSoundId,
  volume: number
): Promise<void> {
  const context = audioContext();
  if (!context || volume <= 0) return;
  if (context.state === 'suspended') {
    if (navigator.userActivation?.hasBeenActive === false) return;
    await context.resume();
  }
  if (context.state !== 'running') return;

  const start = context.currentTime + START_DELAY_S;
  for (const tone of notificationSound(id).tones) {
    const toneStart = start + tone.start;
    const toneEnd = toneStart + tone.duration;
    const peak = MAX_GAIN * volume * tone.gain;

    const gain = context.createGain();
    gain.connect(context.destination);
    gain.gain.setValueAtTime(0, toneStart);
    gain.gain.linearRampToValueAtTime(peak, toneStart + ATTACK_S);
    gain.gain.exponentialRampToValueAtTime(0.0001, toneEnd);

    const oscillator = context.createOscillator();
    oscillator.type = tone.wave;
    oscillator.frequency.setValueAtTime(tone.frequency, toneStart);
    if (tone.glideTo) {
      oscillator.frequency.exponentialRampToValueAtTime(tone.glideTo, toneEnd);
    }
    oscillator.connect(gain);
    oscillator.onended = () => gain.disconnect();
    oscillator.start(toneStart);
    oscillator.stop(toneEnd);
  }
}

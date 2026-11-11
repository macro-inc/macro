import { Telemetry } from '@macro-inc/observability';
import {
  type CallSoundId,
  type NotificationSoundId,
  notificationSound,
} from '../core/sounds';

/** Loudest a tone gets at full volume; notification sounds stay gentle. */
const MAX_GAIN = 0.3;
const ATTACK_S = 0.005;
/** Lead time so the first tone is never scheduled in the past. */
const START_DELAY_S = 0.01;
/** A blocked resume or device switch must not queue a cue for the next gesture. */
const MAX_CUE_DELAY_MS = 250;

/** Calls own an output; notifications keep using the system-default output. */
export function createSoundPlayer(outputDeviceId?: () => string | null) {
  let context: AudioContext | undefined;
  let destination: AudioNode | undefined;
  let output: HTMLAudioElement | undefined;
  let routing: Promise<void> | undefined;
  let disposed = false;

  function audioContext(): AudioContext | undefined {
    if (disposed) return undefined;
    if (context) return context;
    if (typeof AudioContext === 'undefined') return undefined;
    context = new AudioContext();
    destination = context.destination;

    // Use the same output API as LiveKit, including browsers that support
    // HTMLMediaElement.setSinkId but not AudioContext.setSinkId.
    if (outputDeviceId && 'setSinkId' in HTMLMediaElement.prototype) {
      const stream = context.createMediaStreamDestination();
      destination = stream;
      output = new Audio();
      output.srcObject = stream.stream;
    }
    return context;
  }

  async function routeOutput(): Promise<void> {
    if (!output || !outputDeviceId) return;
    // Serialize switches and re-read the selection after each await so an old
    // switch can never overwrite the newest speaker selection.
    while (!disposed && output.sinkId !== (outputDeviceId() ?? '')) {
      await output.setSinkId(outputDeviceId() ?? '');
    }
  }

  async function syncOutput(): Promise<void> {
    if (routing) return routing;
    routing = routeOutput();
    try {
      await routing;
    } finally {
      routing = undefined;
    }
  }

  /** Call synchronously inside the gesture, before any network/media awaits. */
  async function unlock(): Promise<void> {
    const current = audioContext();
    if (!current || current.state === 'closed') return;
    // Start both gated APIs before awaiting either. "interrupted" also needs
    // resume on Safari after the OS temporarily takes the audio device.
    const resume = current.state === 'running' ? undefined : current.resume();
    const play = output?.paused ? output.play() : undefined;
    await Promise.all([resume, play, syncOutput()]);
  }

  async function play(
    id: NotificationSoundId | CallSoundId,
    volume: number
  ): Promise<void> {
    if (disposed || volume <= 0) return;
    await Telemetry.span('audio.cue.play', async (span) => {
      span.setAttr('audio.cue', id);
      const requestedAt = performance.now();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          unlock(),
          new Promise<void>((resolve) => {
            timeout = setTimeout(resolve, MAX_CUE_DELAY_MS);
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
      const current = context;
      if (disposed || !current || !destination) return;
      const expired = performance.now() - requestedAt >= MAX_CUE_DELAY_MS;
      const outputReady = !output || (!output.paused && !routing);
      if (expired || current.state !== 'running' || !outputReady) {
        span.setAttr('audio.outcome', 'not-ready');
        return;
      }

      const start = current.currentTime + START_DELAY_S;
      for (const tone of notificationSound(id).tones) {
        const toneStart = start + tone.start;
        const toneEnd = toneStart + tone.duration;
        const peak = MAX_GAIN * volume * tone.gain;

        const gain = current.createGain();
        gain.connect(destination);
        gain.gain.setValueAtTime(0, toneStart);
        gain.gain.linearRampToValueAtTime(peak, toneStart + ATTACK_S);
        gain.gain.exponentialRampToValueAtTime(0.0001, toneEnd);

        const oscillator = current.createOscillator();
        oscillator.type = tone.wave;
        oscillator.frequency.setValueAtTime(tone.frequency, toneStart);
        if (tone.glideTo) {
          oscillator.frequency.exponentialRampToValueAtTime(
            tone.glideTo,
            toneEnd
          );
        }
        oscillator.connect(gain);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
        oscillator.start(toneStart);
        oscillator.stop(toneEnd);
      }
      span.setAttr('audio.outcome', 'played');
    });
  }

  async function dispose(): Promise<void> {
    disposed = true;
    if (output) {
      output.pause();
      output.srcObject = null;
    }
    if (context && context.state !== 'closed') await context.close();
  }

  return { unlock, play, syncOutput, dispose };
}

const NOTIFICATION_PLAYER = createSoundPlayer();
export const unlockNotificationSounds = NOTIFICATION_PLAYER.unlock;
export const playNotificationSound = NOTIFICATION_PLAYER.play;

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

/**
 * Calls own an output; notifications keep using the system-default output.
 *
 * A chosen speaker is reached through a media element (the same output API
 * as LiveKit, which also covers browsers with HTMLMediaElement.setSinkId but
 * not AudioContext.setSinkId). A playing media element makes WebKit take the
 * iOS audio session for playback, which pauses other apps' music, while a bare
 * AudioContext only mixes with it. So the element plays only while a call has
 * a speaker chosen, and cues go straight to the default output otherwise.
 */
export function createSoundPlayer(outputDeviceId?: () => string | null) {
  let context: AudioContext | undefined;
  let stream: MediaStreamAudioDestinationNode | undefined;
  let output: HTMLAudioElement | undefined;
  let routing: Promise<void> | undefined;
  let starting: Promise<void> | undefined;
  let disposed = false;

  function audioContext(): AudioContext | undefined {
    if (disposed) return undefined;
    if (context) return context;
    if (typeof AudioContext === 'undefined') return undefined;
    context = new AudioContext();
    return context;
  }

  /** The speaker cues must reach, or null for the default output. */
  function chosenOutput(): string | null {
    if (!outputDeviceId || !('setSinkId' in HTMLMediaElement.prototype)) {
      return null;
    }
    return outputDeviceId() || null;
  }

  /** The element feeding the chosen speaker, created on first use. */
  function routedOutput(current: AudioContext): HTMLAudioElement {
    if (!stream || !output) {
      stream = current.createMediaStreamDestination();
      output = new Audio();
      output.srcObject = stream.stream;
    }
    return output;
  }

  async function routeOutput(): Promise<void> {
    // Serialize switches and re-read the selection after each await so an old
    // switch can never overwrite the newest speaker selection.
    while (!disposed && output) {
      const deviceId = chosenOutput();
      if (!deviceId) {
        // Hand the audio session back once no speaker is chosen.
        output.pause();
        return;
      }
      if (output.sinkId === deviceId) return;
      await output.setSinkId(deviceId);
    }
  }

  /** Tones scheduled before the element plays would be lost, so cues wait. */
  async function startOutput(element: HTMLAudioElement): Promise<void> {
    try {
      await element.play();
    } finally {
      starting = undefined;
    }
  }

  async function routeSerialized(): Promise<void> {
    if (routing) return routing;
    routing = routeOutput();
    try {
      await routing;
    } finally {
      routing = undefined;
    }
  }

  /** Start or stop the chosen speaker's element to match the selection. */
  async function syncOutput(): Promise<void> {
    if (disposed) return;
    if (!chosenOutput()) {
      // Hand the audio session back as soon as no speaker is chosen, even
      // while an earlier switch is still settling.
      output?.pause();
      return;
    }

    // A speaker chosen after audio was unlocked starts its element now, so
    // the call's first cue is not dropped while the element starts.
    const element = context ? routedOutput(context) : undefined;
    if (element?.paused) starting = startOutput(element);
    await Promise.all([starting, routeSerialized()]);
  }

  /** Call synchronously inside the gesture, before any network/media awaits. */
  async function unlock(): Promise<void> {
    const current = audioContext();
    if (!current || current.state === 'closed') return;
    // Start both gated APIs before awaiting either: syncOutput starts the
    // chosen speaker's element synchronously. "interrupted" also needs resume
    // on Safari after the OS temporarily takes the audio device.
    const resume = current.state === 'running' ? undefined : current.resume();
    await Promise.all([resume, syncOutput()]);
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
      if (disposed || !current) return;
      const routed = chosenOutput() !== null;
      const destination = routed ? stream : current.destination;
      if (!destination) return;
      const expired = performance.now() - requestedAt >= MAX_CUE_DELAY_MS;
      const outputReady =
        !routed ||
        (output !== undefined && !output.paused && !starting && !routing);
      if (expired || current.state !== 'running' || !outputReady) {
        span.setAttr('audio.outcome', 'not-ready');
        return;
      }

      const sound = notificationSound(id);
      const start = current.currentTime + START_DELAY_S;
      for (const tone of sound.tones) {
        const toneStart = start + tone.start;
        const toneEnd = toneStart + tone.duration;
        const peak = (sound.gain ?? MAX_GAIN) * volume * tone.gain;
        const endGain =
          sound.decayRatio === undefined ? 0.0001 : peak * sound.decayRatio;

        const gain = current.createGain();
        gain.connect(destination);
        gain.gain.setValueAtTime(0, toneStart);
        gain.gain.linearRampToValueAtTime(peak, toneStart + ATTACK_S);
        if (tone.hold) {
          gain.gain.setValueAtTime(peak, toneStart + ATTACK_S + tone.hold);
        }
        gain.gain.exponentialRampToValueAtTime(endGain, toneEnd);

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

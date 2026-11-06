import { fireAndForget } from '@core/util/fireAndForget';
import {
  type RemoteParticipant,
  type Room,
  RoomEvent,
  Track,
} from 'livekit-client';

const SAMPLE_INTERVAL_MS = 50;
const SPEECH_RMS_THRESHOLD = 0.005;
const RELEASE_HOLD_MS = 250;

type SpeakerRoom = Pick<
  Room,
  'localParticipant' | 'remoteParticipants' | 'on' | 'off'
>;

type Input = {
  track: MediaStreamTrack;
  source?: MediaStreamAudioSourceNode;
  analyser?: AnalyserNode;
  samples?: Float32Array<ArrayBuffer>;
  lastSpeechAt: number;
};

/** Samples published microphone tracks without attaching them to playback. */
export function startCallSpeakerDetection(
  room: SpeakerRoom,
  onChange: (identities: ReadonlySet<string>) => void
): () => void {
  let context: AudioContext | undefined;
  try {
    if (typeof AudioContext !== 'undefined') context = new AudioContext();
  } catch {
    // SDK speaking events remain available if Web Audio cannot start.
  }

  const inputs = new Map<string, Input>();
  let speaking = new Set<string>();
  let stopped = false;

  function removeInput(identity: string) {
    const input = inputs.get(identity);
    if (!input) return;
    input.track.removeEventListener('ended', refresh);
    input.source?.disconnect();
    input.analyser?.disconnect();
    inputs.delete(identity);
  }

  function getInput(identity: string, track: MediaStreamTrack): Input {
    const previous = inputs.get(identity);
    if (previous?.track === track) return previous;
    removeInput(identity);
    const input: Input = { track, lastSpeechAt: -Infinity };
    inputs.set(identity, input);
    track.addEventListener('ended', refresh);
    if (context) {
      try {
        input.source = context.createMediaStreamSource(
          new MediaStream([track])
        );
        input.analyser = context.createAnalyser();
        input.analyser.fftSize = 1024;
        input.samples = new Float32Array(input.analyser.fftSize);
        input.source.connect(input.analyser);
        // Never connect the analyser to the destination: this is visual only.
      } catch {
        input.source?.disconnect();
        input.analyser?.disconnect();
        input.source = undefined;
        input.analyser = undefined;
      }
    }
    return input;
  }

  function sampleParticipant(
    participant: Room['localParticipant'] | RemoteParticipant,
    next: Set<string>
  ) {
    const identity = participant.identity;
    const publication = participant.getTrackPublication(
      Track.Source.Microphone
    );
    const track = publication?.audioTrack?.mediaStreamTrack;
    if (
      participant.isAgent ||
      !publication ||
      publication.isMuted ||
      !publication.isEnabled
    ) {
      removeInput(identity);
      return;
    }

    if (!track) {
      removeInput(identity);
      if (participant.isSpeaking) next.add(identity);
      return;
    }
    if (!track.enabled || track.readyState !== 'live') {
      removeInput(identity);
      return;
    }

    const input = getInput(identity, track);

    if (context?.state !== 'running' || !input.analyser || !input.samples) {
      input.lastSpeechAt = -Infinity;
      if (participant.isSpeaking) next.add(identity);
      return;
    }

    input.analyser.getFloatTimeDomainData(input.samples);
    let energy = 0;
    let sum = 0;
    for (const sample of input.samples) {
      energy += sample * sample;
      sum += sample;
    }
    // Ignore microphone DC offset; only changing audio contributes activity.
    const mean = sum / input.samples.length;
    const rms = Math.sqrt(
      Math.max(0, energy / input.samples.length - mean * mean)
    );
    if (rms >= SPEECH_RMS_THRESHOLD) {
      input.lastSpeechAt = Date.now();
    }
    if (Date.now() - input.lastSpeechAt < RELEASE_HOLD_MS) next.add(identity);
  }

  function refresh() {
    if (stopped) return;
    const next = new Set<string>();
    const participants = [
      room.localParticipant,
      ...room.remoteParticipants.values(),
    ];
    for (const participant of participants)
      sampleParticipant(participant, next);

    for (const identity of inputs.keys()) {
      if (
        !participants.some((participant) => participant.identity === identity)
      ) {
        removeInput(identity);
      }
    }

    if (
      next.size !== speaking.size ||
      [...next].some((identity) => !speaking.has(identity))
    ) {
      speaking = next;
      onChange(next);
    }
  }

  async function resumeAnalysis() {
    if (
      stopped ||
      !context ||
      context.state === 'running' ||
      context.state === 'closed' ||
      document.hidden
    ) {
      return;
    }
    try {
      await context.resume();
    } catch {
      // Continue using SDK speaking until analysis can run.
    }
    refresh();
  }

  const events = [
    RoomEvent.ParticipantConnected,
    RoomEvent.ParticipantDisconnected,
    RoomEvent.TrackPublished,
    RoomEvent.TrackUnpublished,
    RoomEvent.TrackSubscribed,
    RoomEvent.TrackUnsubscribed,
    RoomEvent.TrackMuted,
    RoomEvent.TrackUnmuted,
    RoomEvent.LocalTrackPublished,
    RoomEvent.LocalTrackUnpublished,
    RoomEvent.ActiveSpeakersChanged,
  ];
  for (const event of events) room.on(event, refresh);
  context?.addEventListener('statechange', refresh);
  const restoreAnalysis = () => {
    fireAndForget(resumeAnalysis(), 'channel-call');
  };
  const interaction = (event: Event) => {
    if (event.isTrusted) restoreAnalysis();
  };
  room.on(RoomEvent.LocalTrackPublished, restoreAnalysis);
  document.addEventListener('visibilitychange', restoreAnalysis);
  document.addEventListener('pointerdown', interaction);
  document.addEventListener('keydown', interaction);
  const timer = setInterval(refresh, SAMPLE_INTERVAL_MS);
  refresh();
  restoreAnalysis();

  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    for (const event of events) room.off(event, refresh);
    room.off(RoomEvent.LocalTrackPublished, restoreAnalysis);
    document.removeEventListener('visibilitychange', restoreAnalysis);
    document.removeEventListener('pointerdown', interaction);
    document.removeEventListener('keydown', interaction);
    context?.removeEventListener('statechange', refresh);
    for (const identity of inputs.keys()) removeInput(identity);
    if (context && context.state !== 'closed') {
      fireAndForget(context.close(), 'channel-call');
    }
  };
}

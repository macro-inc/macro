import type { RemoteAudioTrack, Room } from 'livekit-client';
import { parseWorkerEvent } from '../core/protocol';
import type {
  VoiceCredentials,
  VoiceMedia,
  VoiceMediaEvents,
  VoiceMicrophone,
} from '../core/types';

/** Publish the microphone already granted by the browser's Start gesture. */
export async function createLivekitVoiceMedia(
  credentials: VoiceCredentials,
  events: VoiceMediaEvents,
  microphone: VoiceMicrophone
): Promise<VoiceMedia> {
  let livekit: typeof import('livekit-client');
  try {
    livekit = await import('livekit-client');
  } catch (error) {
    microphone.stop();
    throw error;
  }
  const { Room, RoomEvent, Track } = livekit;
  const room: Room = new Room({
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    publishDefaults: { dtx: false },
  });
  let disposed = false;
  let workerReady = false;
  let connectedOnce = false;
  let recovering = false;
  let networkReconnecting = false;
  let workerFailure: string | undefined;
  let resolveReady: (() => void) | undefined;
  let cancelStartup: (() => void) | undefined;
  let rejectStartup: ((error: Error) => void) | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let participantInterval: ReturnType<typeof setInterval> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let workerLeaveTimer: ReturnType<typeof setTimeout> | undefined;
  let workerTimer: ReturnType<typeof setTimeout> | undefined;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  const audioElements = new Map<RemoteAudioTrack, HTMLMediaElement>();
  const streams = new Set<AbortController>();
  const recoveryWaiters = new Set<{
    resolve: () => void;
    reject: (error: Error) => void;
  }>();
  let audioContext: AudioContext | undefined;
  let inputMeter:
    | { analyser: AnalyserNode; source: MediaStreamAudioSourceNode }
    | undefined;
  let outputMeter:
    | { analyser: AnalyserNode; source: MediaStreamAudioSourceNode }
    | undefined;
  const fail = (message: string) => {
    if (disposed || workerFailure) return;
    microphone.stop();
    workerFailure = message;
    for (const waiting of recoveryWaiters) waiting.reject(new Error(message));
    recoveryWaiters.clear();
    rejectStartup?.(new Error(message));
    resolveReady?.();
    events.failure(message);
  };
  const markReady = () => {
    if (disposed || workerFailure) return;
    const newlyReady = !workerReady;
    workerReady = true;
    clearTimeout(workerTimer);
    clearTimeout(workerLeaveTimer);
    workerLeaveTimer = undefined;
    resolveReady?.();
    if (newlyReady) events.agentState('listening');
    finishRecovery();
  };
  const participantState = (participant: {
    identity: string;
    attributes: Record<string, string>;
  }) => {
    if (participant.identity !== credentials.agentIdentity) return;
    const status = participant.attributes['macro.voice.status'];
    if (status) {
      const event = parseWorkerEvent(new TextEncoder().encode(status));
      if (event && event.type !== 'ready') {
        // parseWorkerEvent already checked that this is a bounded JSON object.
        const generation: unknown = JSON.parse(status);
        if (
          typeof generation === 'object' &&
          generation !== null &&
          'voiceSessionId' in generation &&
          generation.voiceSessionId === credentials.voiceSessionId
        ) {
          fail(
            event.message ?? 'The voice agent disconnected. Please try again.'
          );
          return;
        }
      }
    }
    if (
      participant.attributes['macro.voice.ready'] === credentials.voiceSessionId
    )
      markReady();
  };
  const createMeter = (track: MediaStreamTrack) => {
    audioContext ??= new AudioContext();
    const source = audioContext.createMediaStreamSource(
      new MediaStream([track])
    );
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    return { source, analyser };
  };
  const startPlayback = async () => {
    try {
      await Promise.all([audioContext?.resume(), room.startAudio()]);
      if (!disposed) events.playbackBlocked(!room.canPlaybackAudio);
    } catch {
      if (!disposed) events.playbackBlocked(true);
    }
  };
  const beginRecovery = () => {
    if (recovering) return;
    recovering = true;
    for (const element of audioElements.values()) element.muted = true;
    events.levels(0, 0);
    events.connection('reconnecting');
  };
  const finishRecovery = () => {
    if (
      disposed ||
      workerFailure ||
      !recovering ||
      networkReconnecting ||
      !workerReady ||
      !connectedOnce
    )
      return;
    recovering = false;
    for (const element of audioElements.values()) element.muted = false;
    for (const waiting of recoveryWaiters) waiting.resolve();
    recoveryWaiters.clear();
    void startPlayback();
    events.connection('connected');
  };
  const level = (meter: typeof inputMeter) => {
    if (!meter) return 0;
    const samples = new Float32Array(meter.analyser.fftSize);
    meter.analyser.getFloatTimeDomainData(samples);
    return Math.min(
      1,
      Math.sqrt(
        samples.reduce((sum, sample) => sum + sample * sample, 0) /
          samples.length
      ) * 4
    );
  };
  room.registerTextStreamHandler('lk.transcription', (reader, participant) => {
    if (
      disposed ||
      (participant.identity !== credentials.agentIdentity &&
        participant.identity !== credentials.participantIdentity)
    )
      return;
    const abort = new AbortController();
    streams.add(abort);
    const sourceTrack = reader.info.attributes?.['lk.transcribed_track_id'];
    const localTrack = room.localParticipant.getTrackPublication(
      Track.Source.Microphone
    )?.trackSid;
    const speaker =
      participant.identity === credentials.participantIdentity ||
      (sourceTrack && sourceTrack === localTrack)
        ? ('user' as const)
        : ('agent' as const);
    const id = `${speaker}:${reader.info.attributes?.['lk.segment_id'] ?? reader.info.id}`;
    void (async () => {
      let text = '';
      try {
        for await (const chunk of reader.withAbortSignal(abort.signal)) {
          if (disposed) return;
          text = (text + chunk).slice(0, 8000);
          events.caption({ id, speaker, text, final: false });
        }
        if (!disposed) events.caption({ id, speaker, text, final: true });
      } catch {
        /* Caption streams may end on interruption or disconnect. */
      } finally {
        streams.delete(abort);
      }
    })();
  });
  room.on(RoomEvent.Reconnecting, () => {
    if (disposed || networkReconnecting) return;
    networkReconnecting = true;
    beginRecovery();
    reconnectTimer = setTimeout(
      () =>
        fail(
          'Voice could not reconnect. Start again when your connection is stable.'
        ),
      120_000
    );
  });
  room.on(RoomEvent.Reconnected, () => {
    if (disposed || workerFailure) return;
    networkReconnecting = false;
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    const worker = room.remoteParticipants.get(credentials.agentIdentity);
    if (worker) participantState(worker);
    finishRecovery();
  });
  room.on(RoomEvent.Disconnected, () => {
    microphone.stop();
    resolveReady?.();
    if (!disposed) events.connection('disconnected');
  });
  room.on(RoomEvent.AudioPlaybackStatusChanged, () =>
    events.playbackBlocked(!room.canPlaybackAudio)
  );
  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    if (disposed || participant.identity !== credentials.agentIdentity) return;
    workerReady = false;
    beginRecovery();
    if (!workerLeaveTimer)
      workerLeaveTimer = setTimeout(
        () => fail('The voice agent could not reconnect. Please try again.'),
        120_000
      );
  });
  room.on(RoomEvent.ParticipantConnected, participantState);
  room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
    if (
      disposed ||
      participant.identity !== credentials.agentIdentity ||
      track.kind !== Track.Kind.Audio
    )
      return;
    const audio = track as RemoteAudioTrack;
    const element = audio.attach();
    element.muted = recovering;
    element.style.display = 'none';
    document.body.append(element);
    audioElements.set(audio, element);
    async function play() {
      try {
        await element.play();
      } catch {
        if (!disposed) events.playbackBlocked(true);
      }
    }
    void play();
    try {
      outputMeter?.source.disconnect();
      outputMeter = createMeter(audio.mediaStreamTrack);
    } catch {
      /* Playback remains usable if a browser cannot analyse this track. */
    }
  });
  room.on(RoomEvent.TrackUnsubscribed, (track) => {
    const audio = track as RemoteAudioTrack;
    const element = audioElements.get(audio);
    if (element) {
      audio.detach(element);
      element.remove();
      audioElements.delete(audio);
      outputMeter?.source.disconnect();
      outputMeter = undefined;
    }
  });
  room.on(RoomEvent.ParticipantAttributesChanged, (attributes, participant) => {
    if (disposed || participant.identity !== credentials.agentIdentity) return;
    participantState(participant);
    const state = attributes['lk.agent.state'];
    if (state === 'listening' || state === 'thinking' || state === 'speaking')
      events.agentState(state);
  });
  room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
    if (
      disposed ||
      !participant ||
      (participant.identity !== credentials.agentIdentity &&
        participant.identity !== credentials.participantIdentity)
    )
      return;
    for (const segment of segments)
      events.caption({
        id: `${participant.identity === credentials.agentIdentity ? 'agent' : 'user'}:${segment.id}`,
        speaker:
          participant.identity === credentials.agentIdentity ? 'agent' : 'user',
        text: segment.text.slice(0, 8000),
        final: segment.final,
      });
  });
  room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
    if (
      disposed ||
      participant?.identity !== credentials.agentIdentity ||
      topic !== 'macro.voice.event'
    )
      return;
    const event = parseWorkerEvent(payload);
    if (event?.type === 'ready') markReady();
    if (event?.type === 'error' || event?.type === 'ended')
      fail(event.message ?? 'The voice agent disconnected. Please try again.');
  });
  const connect = async () => {
    if (disposed) return;
    await room.connect(credentials.url, credentials.token, {
      autoSubscribe: true,
      websocketTimeout: 15_000,
      peerConnectionTimeout: 15_000,
    });
    if (disposed) {
      await room.disconnect();
      return;
    }
    // The worker may already be ready in the initial room snapshot; its
    // one-shot data packet can arrive before the browser joins the room.
    const worker = room.remoteParticipants.get(credentials.agentIdentity);
    if (worker) participantState(worker);
    if (workerFailure) throw new Error(workerFailure);
    // SDK join/attribute notifications can remain buffered across a reconnect.
    // Reconcile durable state from its already-updated participant snapshot.
    participantInterval = setInterval(() => {
      if (disposed || networkReconnecting) return;
      const participant = room.remoteParticipants.get(
        credentials.agentIdentity
      );
      if (participant) participantState(participant);
    }, 1000);
    await room.localParticipant.publishTrack(microphone.track, {
      source: Track.Source.Microphone,
      stopMicTrackOnMute: false,
    });
    if (disposed) {
      await room.disconnect();
      return;
    }
    const track = room.localParticipant.getTrackPublication(
      Track.Source.Microphone
    )?.track;
    if (track) {
      try {
        inputMeter = createMeter(track.mediaStreamTrack);
      } catch {
        /* Mic still works without a meter. */
      }
    }
    // Autoplay can leave resume()/play() pending until a later user gesture.
    // It must not prevent readiness or the worker timeout from progressing.
    events.playbackBlocked(
      audioContext?.state === 'suspended' || !room.canPlaybackAudio
    );
    void startPlayback();
    interval = setInterval(
      () =>
        events.levels(
          !recovering && room.localParticipant.isMicrophoneEnabled
            ? level(inputMeter)
            : 0,
          recovering ? 0 : level(outputMeter)
        ),
      50
    );
    if (!workerReady)
      workerTimer = setTimeout(
        () => fail('The voice agent did not connect. Please try again.'),
        30_000
      );
    while (!workerReady && !disposed && !workerFailure)
      await new Promise<void>((resolve) => {
        resolveReady = resolve;
      });
    if (disposed) return;
    if (workerFailure) throw new Error(workerFailure);
    if (!workerReady)
      throw new Error('The voice agent disconnected before it was ready.');
    connectedOnce = true;
    if (recovering) {
      finishRecovery();
      if (recovering)
        await new Promise<void>((resolve, reject) =>
          recoveryWaiters.add({ resolve, reject })
        );
    } else events.connection('connected');
  };
  const disconnect = async () => {
    disposed = true;
    microphone.stop();
    cancelStartup?.();
    resolveReady?.();
    clearInterval(interval);
    clearInterval(participantInterval);
    clearTimeout(reconnectTimer);
    clearTimeout(workerLeaveTimer);
    clearTimeout(workerTimer);
    clearTimeout(startupTimer);
    for (const waiting of recoveryWaiters)
      waiting.reject(new Error('Voice has ended.'));
    recoveryWaiters.clear();
    room.unregisterTextStreamHandler('lk.transcription');
    for (const stream of streams) stream.abort();
    streams.clear();
    for (const [track, element] of audioElements) {
      track.detach(element);
      element.remove();
    }
    audioElements.clear();
    inputMeter?.source.disconnect();
    outputMeter?.source.disconnect();
    try {
      await audioContext?.close();
    } catch {
      /* A context may already be closed during browser teardown. */
    }
    try {
      await room.disconnect();
    } finally {
      room.removeAllListeners();
    }
  };
  return {
    connect: async () => {
      if (disposed) return;
      const interrupted = new Promise<void>((resolve, reject) => {
        cancelStartup = resolve;
        rejectStartup = reject;
      });
      // Also cover SDK connection/publication stalls before the worker timer.
      startupTimer = setTimeout(
        () => fail('Voice took too long to connect. Please try again.'),
        45_000
      );
      try {
        await Promise.race([connect(), interrupted]);
      } catch (error) {
        await disconnect();
        throw error;
      } finally {
        clearTimeout(startupTimer);
        cancelStartup = undefined;
        rejectStartup = undefined;
      }
    },
    disconnect,
    mute: async (muted) => {
      if (disposed) return;
      await room.localParticipant.setMicrophoneEnabled(!muted);
      if (!muted) {
        const track = room.localParticipant.getTrackPublication(
          Track.Source.Microphone
        )?.track;
        if (track) {
          inputMeter?.source.disconnect();
          try {
            inputMeter = createMeter(track.mediaStreamTrack);
          } catch {
            inputMeter = undefined;
          }
        }
      }
    },
    enablePlayback: async () => {
      await audioContext?.resume();
      await room.startAudio();
      events.playbackBlocked(!room.canPlaybackAudio);
    },
  };
}

import type { RemoteAudioTrack, Room, RpcInvocationData } from 'livekit-client';
import {
  parseAgentCancel,
  parseAgentRequest,
  parseWorkerEvent,
  serializeVoicePayload,
} from '../core/protocol';
import type {
  VoiceBridge,
  VoiceCredentials,
  VoiceMedia,
  VoiceMediaEvents,
} from '../core/types';

/** Dedicated agent audio transport; SDK and capture load only after Start. */
export async function createLivekitVoiceMedia(
  credentials: VoiceCredentials,
  events: VoiceMediaEvents,
  bridge: VoiceBridge
): Promise<VoiceMedia> {
  const { Room, RoomEvent, Track, RpcError } = await import('livekit-client');
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
  let workerFailure: string | undefined;
  let resolveReady: (() => void) | undefined;
  let sequence = 0;
  let interval: ReturnType<typeof setInterval> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let workerTimer: ReturnType<typeof setTimeout> | undefined;
  const audioElements = new Map<RemoteAudioTrack, HTMLMediaElement>();
  const streams = new Set<AbortController>();
  let audioContext: AudioContext | undefined;
  let inputMeter:
    | { analyser: AnalyserNode; source: MediaStreamAudioSourceNode }
    | undefined;
  let outputMeter:
    | { analyser: AnalyserNode; source: MediaStreamAudioSourceNode }
    | undefined;
  const fail = (message: string) => {
    if (disposed) return;
    workerFailure = message;
    resolveReady?.();
    events.failure(message);
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
  const authorized = (request: RpcInvocationData) => {
    if (disposed || request.callerIdentity !== credentials.agentIdentity)
      throw new RpcError(1500, 'Unauthorized voice participant');
  };
  room.localParticipant.registerRpcMethod(
    'macro.agent.request',
    async (request) => {
      authorized(request);
      return serializeVoicePayload(
        await bridge.request(parseAgentRequest(request.payload))
      );
    }
  );
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
  room.localParticipant.registerRpcMethod(
    'macro.agent.cancel',
    async (request) => {
      authorized(request);
      return serializeVoicePayload(
        await bridge.cancel(parseAgentCancel(request.payload))
      );
    }
  );
  room.localParticipant.registerRpcMethod(
    'macro.voice.context',
    async (request) => {
      authorized(request);
      return serializeVoicePayload(await bridge.context());
    }
  );
  room.on(RoomEvent.Reconnecting, () => {
    if (disposed) return;
    events.connection('reconnecting');
    for (const element of audioElements.values()) element.muted = true;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(
      () =>
        fail(
          'Voice could not reconnect. Start again when your connection is stable.'
        ),
      20_000
    );
  });
  room.on(RoomEvent.Reconnected, () => {
    clearTimeout(reconnectTimer);
    // End instead of resuming potentially stale speech/context after signal loss.
    if (!disposed)
      fail('Your connection changed. Start voice again to continue safely.');
  });
  room.on(RoomEvent.Disconnected, () => {
    resolveReady?.();
    if (!disposed) events.connection('disconnected');
  });
  room.on(RoomEvent.AudioPlaybackStatusChanged, () =>
    events.playbackBlocked(!room.canPlaybackAudio)
  );
  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    if (!disposed && participant.identity === credentials.agentIdentity)
      fail('The voice agent disconnected. Start again to continue.');
  });
  room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
    if (
      disposed ||
      participant.identity !== credentials.agentIdentity ||
      track.kind !== Track.Kind.Audio
    )
      return;
    const audio = track as RemoteAudioTrack;
    const element = audio.attach();
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
    if (event?.type === 'ready') {
      workerReady = true;
      clearTimeout(workerTimer);
      resolveReady?.();
      events.agentState('listening');
    }
    if (event?.type === 'error' || event?.type === 'ended')
      fail(event.message ?? 'The voice agent disconnected. Please try again.');
  });
  return {
    connect: async () => {
      const ready = new Promise<void>((resolve) => {
        resolveReady = resolve;
      });
      await room.connect(credentials.url, credentials.token, {
        autoSubscribe: true,
        websocketTimeout: 15_000,
        peerConnectionTimeout: 15_000,
      });
      if (disposed) {
        await room.disconnect();
        return;
      }
      await room.localParticipant.setMicrophoneEnabled(true);
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
      try {
        await audioContext?.resume();
        await room.startAudio();
      } catch {
        if (!disposed) events.playbackBlocked(true);
      }
      if (disposed) {
        await room.disconnect();
        return;
      }
      interval = setInterval(
        () =>
          events.levels(
            room.localParticipant.isMicrophoneEnabled ? level(inputMeter) : 0,
            level(outputMeter)
          ),
        50
      );
      if (!workerReady)
        workerTimer = setTimeout(
          () => fail('The voice agent did not connect. Please try again.'),
          30_000
        );
      if (!workerReady) await ready;
      if (disposed) return;
      if (workerFailure) throw new Error(workerFailure);
      if (!workerReady)
        throw new Error('The voice agent disconnected before it was ready.');
      events.connection('connected');
    },
    disconnect: async () => {
      disposed = true;
      resolveReady?.();
      clearInterval(interval);
      clearTimeout(reconnectTimer);
      clearTimeout(workerTimer);
      room.localParticipant.unregisterRpcMethod('macro.agent.request');
      room.localParticipant.unregisterRpcMethod('macro.agent.cancel');
      room.localParticipant.unregisterRpcMethod('macro.voice.context');
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
    },
    mute: async (muted) => {
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
    publish: async (event) =>
      room.localParticipant.publishData(
        new TextEncoder().encode(
          serializeVoicePayload({
            ...event,
            voiceSessionId: credentials.voiceSessionId,
            seq: ++sequence,
          })
        ),
        {
          reliable: true,
          topic: 'macro.agent.event',
          destinationIdentities: [credentials.agentIdentity],
        }
      ),
  };
}

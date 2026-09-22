import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  VoiceCredentials,
  VoiceMediaEvents,
  VoiceMicrophone,
} from '../core/types';

const fake = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const rpc = new Map<
    string,
    (request: { callerIdentity: string; payload: string }) => Promise<string>
  >();
  return {
    handlers,
    rpc,
    participants: new Map<
      string,
      { identity: string; attributes: Record<string, string> }
    >(),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    microphone: vi.fn(async () => {}),
    publishTrack: vi.fn(async () => {}),
    publication: vi.fn<
      () => { track: { mediaStreamTrack: MediaStreamTrack } } | undefined
    >(() => undefined),
    startAudio: vi.fn(async () => {}),
    publish: vi.fn(async () => {}),
  };
});

vi.mock('livekit-client', () => ({
  RoomEvent: {
    Reconnecting: 'reconnecting',
    Reconnected: 'reconnected',
    Disconnected: 'disconnected',
    AudioPlaybackStatusChanged: 'playback',
    ParticipantDisconnected: 'left',
    ParticipantConnected: 'joined',
    TrackSubscribed: 'track',
    TrackUnsubscribed: 'untrack',
    ParticipantAttributesChanged: 'attributes',
    TranscriptionReceived: 'transcription',
    DataReceived: 'data',
  },
  Track: { Source: { Microphone: 'microphone' }, Kind: { Audio: 'audio' } },
  RpcError: class extends Error {
    constructor(_code: number, message: string) {
      super(message);
    }
  },
  Room: class {
    canPlaybackAudio = true;
    remoteParticipants = fake.participants;
    localParticipant = {
      registerRpcMethod: (
        name: string,
        handler: typeof fake.rpc extends Map<string, infer H> ? H : never
      ) => fake.rpc.set(name, handler),
      unregisterRpcMethod: (name: string) => fake.rpc.delete(name),
      setMicrophoneEnabled: fake.microphone,
      publishTrack: fake.publishTrack,
      getTrackPublication: fake.publication,
      isMicrophoneEnabled: true,
      publishData: fake.publish,
    };
    connect = fake.connect;
    disconnect = fake.disconnect;
    startAudio = fake.startAudio;
    registerTextStreamHandler() {}
    unregisterTextStreamHandler() {}
    removeAllListeners() {
      fake.handlers.clear();
    }
    on(name: string, handler: (...args: unknown[]) => void) {
      fake.handlers.set(name, handler);
    }
  },
}));

import { createLivekitVoiceMedia } from './livekit-media';

const credentials: VoiceCredentials = {
  voiceSessionId: '0195a574-e470-7a43-b74c-d06a7f374835',
  roomName: 'room',
  url: 'wss://voice.example',
  token: 'test-only',
  participantIdentity: 'browser',
  agentIdentity: 'expected-worker',
  expiresAt: '2026-09-23T00:00:00Z',
  voice: 'marin',
};
const events = () =>
  ({
    connection: vi.fn(),
    levels: vi.fn(),
    caption: vi.fn(),
    agentState: vi.fn(),
    playbackBlocked: vi.fn(),
    failure: vi.fn(),
  }) satisfies VoiceMediaEvents;
function workerEvent(identity: string, type: string) {
  fake.handlers.get('data')?.(
    new TextEncoder().encode(JSON.stringify({ version: 1, type })),
    { identity },
    undefined,
    'macro.voice.event'
  );
}
function microphone(): VoiceMicrophone {
  return { track: {} as MediaStreamTrack, stop: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.publication.mockReturnValue(undefined);
  fake.handlers.clear();
  fake.rpc.clear();
  fake.participants.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mockMeter(resume: () => Promise<void> = async () => {}) {
  vi.stubGlobal('MediaStream', class {});
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'suspended';
      resume = resume;
      close = async () => {};
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() };
      }
      createAnalyser() {
        return {
          fftSize: 256,
          getFloatTimeDomainData: (samples: Float32Array) => samples.fill(0.2),
        };
      }
    }
  );
  fake.publication.mockReturnValue({
    track: { mediaStreamTrack: {} as MediaStreamTrack },
  });
}

describe('LiveKit voice boundary', () => {
  it('connects media without exposing a browser task delegation endpoint', async () => {
    const media = await createLivekitVoiceMedia(
      credentials,
      events(),
      microphone()
    );
    workerEvent(credentials.agentIdentity, 'ready');
    await media.connect();
    expect(fake.rpc.size).toBe(0);
    expect(fake.publish).not.toHaveBeenCalled();
    await media.disconnect();
  });
  it('does not announce listening until the correct worker is ready', async () => {
    const callbacks = events();
    const media = await createLivekitVoiceMedia(
      credentials,
      callbacks,
      microphone()
    );
    const connected = media.connect();
    await vi.waitFor(() => expect(fake.publishTrack).toHaveBeenCalled());
    workerEvent('untrusted', 'ready');
    expect(callbacks.connection).not.toHaveBeenCalled();
    workerEvent(credentials.agentIdentity, 'ready');
    await connected;
    expect(callbacks.connection).toHaveBeenCalledExactlyOnceWith('connected');
    await media.disconnect();
  });
  it('ends an interrupted connect without publishing late microphone audio', async () => {
    let resolve!: () => void;
    fake.connect.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        })
    );
    const callbacks = events();
    const capture = microphone();
    const media = await createLivekitVoiceMedia(
      credentials,
      callbacks,
      capture
    );
    const connected = media.connect();
    await media.disconnect();
    resolve();
    await connected;
    expect(fake.microphone).not.toHaveBeenCalled();
    expect(fake.publishTrack).not.toHaveBeenCalled();
    expect(capture.stop).toHaveBeenCalled();
    expect(callbacks.connection).not.toHaveBeenCalled();
  });
  it('publishes the granted track without opening a second microphone', async () => {
    const capture = microphone();
    const media = await createLivekitVoiceMedia(credentials, events(), capture);
    const connected = media.connect();
    await vi.waitFor(() => expect(fake.publishTrack).toHaveBeenCalled());
    expect(fake.publishTrack).toHaveBeenCalledExactlyOnceWith(capture.track, {
      source: 'microphone',
      stopMicTrackOnMute: false,
    });
    expect(fake.microphone).not.toHaveBeenCalled();
    workerEvent(credentials.agentIdentity, 'ready');
    await connected;
    await media.mute(true);
    await media.mute(false);
    expect(fake.microphone.mock.calls).toEqual([[false], [true]]);
    await media.disconnect();
    expect(capture.stop).toHaveBeenCalled();
  });
  it('releases microphone capture when room connection fails', async () => {
    fake.connect.mockRejectedValueOnce(new Error('Network failed'));
    const capture = microphone();
    const media = await createLivekitVoiceMedia(credentials, events(), capture);
    await expect(media.connect()).rejects.toThrow('Network failed');
    expect(capture.stop).toHaveBeenCalled();
    expect(fake.publishTrack).not.toHaveBeenCalled();
    expect(fake.disconnect).toHaveBeenCalled();
  });
  it('releases microphone capture when track publication fails', async () => {
    fake.publishTrack.mockRejectedValueOnce(new Error('Publish failed'));
    const capture = microphone();
    const media = await createLivekitVoiceMedia(credentials, events(), capture);
    await expect(media.connect()).rejects.toThrow('Publish failed');
    expect(capture.stop).toHaveBeenCalled();
    expect(fake.disconnect).toHaveBeenCalled();
  });
  it('stops capture during pending publication and ignores its late completion', async () => {
    let resolve!: () => void;
    fake.publishTrack.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        })
    );
    const capture = microphone();
    const callbacks = events();
    const media = await createLivekitVoiceMedia(
      credentials,
      callbacks,
      capture
    );
    const connected = media.connect();
    await vi.waitFor(() => expect(fake.publishTrack).toHaveBeenCalled());
    await media.disconnect();
    expect(capture.stop).toHaveBeenCalled();
    resolve();
    await connected;
    expect(callbacks.connection).not.toHaveBeenCalled();
    expect(fake.microphone).not.toHaveBeenCalled();
  });
  it('becomes ready while the browser leaves audio resume pending', async () => {
    mockMeter(() => new Promise<void>(() => {}));
    const callbacks = events();
    const media = await createLivekitVoiceMedia(
      credentials,
      callbacks,
      microphone()
    );
    const connected = media.connect();
    await vi.waitFor(() => expect(fake.startAudio).toHaveBeenCalled());
    expect(callbacks.playbackBlocked).toHaveBeenCalledWith(true);
    workerEvent(credentials.agentIdentity, 'ready');
    await connected;
    expect(callbacks.connection).toHaveBeenCalledWith('connected');
    await media.disconnect();
  });
  it('fails visibly when the microphone works but no worker becomes ready', async () => {
    vi.useFakeTimers();
    mockMeter(() => new Promise<void>(() => {}));
    const callbacks = events();
    const capture = microphone();
    const media = await createLivekitVoiceMedia(
      credentials,
      callbacks,
      capture
    );
    const connected = media.connect();
    const rejected = expect(connected).rejects.toThrow(
      'voice agent did not connect'
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(callbacks.levels).toHaveBeenCalled();
    expect(callbacks.levels.mock.calls[0][0]).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(callbacks.failure).toHaveBeenCalledExactlyOnceWith(
      'The voice agent did not connect. Please try again.'
    );
    expect(capture.stop).toHaveBeenCalled();
    expect(callbacks.connection).not.toHaveBeenCalled();
  });
  it('bounds a stalled transport and ignores its eventual connection', async () => {
    vi.useFakeTimers();
    let resolve!: () => void;
    fake.connect.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        })
    );
    const capture = microphone();
    const callbacks = events();
    const media = await createLivekitVoiceMedia(
      credentials,
      callbacks,
      capture
    );
    const connected = media.connect();
    const rejected = expect(connected).rejects.toThrow('too long to connect');
    await vi.advanceTimersByTimeAsync(45_000);
    await rejected;
    expect(capture.stop).toHaveBeenCalled();
    resolve();
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.publishTrack).not.toHaveBeenCalled();
    expect(callbacks.connection).not.toHaveBeenCalled();
  });
  it('reads durable readiness from the initial room snapshot', async () => {
    fake.participants.set(credentials.agentIdentity, {
      identity: credentials.agentIdentity,
      attributes: { 'macro.voice.ready': credentials.voiceSessionId },
    });
    const callbacks = events();
    const media = await createLivekitVoiceMedia(
      credentials,
      callbacks,
      microphone()
    );
    await media.connect();
    expect(callbacks.connection).toHaveBeenCalledWith('connected');
    await media.disconnect();
  });
  it('accepts durable readiness only from the expected worker and voice session', async () => {
    const callbacks = events();
    const media = await createLivekitVoiceMedia(
      credentials,
      callbacks,
      microphone()
    );
    const connected = media.connect();
    await vi.waitFor(() => expect(fake.publishTrack).toHaveBeenCalled());
    fake.handlers.get('joined')?.({
      identity: 'untrusted',
      attributes: { 'macro.voice.ready': credentials.voiceSessionId },
    });
    fake.handlers.get('attributes')?.(
      { 'macro.voice.ready': 'another-session' },
      {
        identity: credentials.agentIdentity,
        attributes: { 'macro.voice.ready': 'another-session' },
      }
    );
    expect(callbacks.connection).not.toHaveBeenCalled();
    fake.handlers.get('attributes')?.(
      { 'macro.voice.ready': credentials.voiceSessionId },
      {
        identity: credentials.agentIdentity,
        attributes: { 'macro.voice.ready': credentials.voiceSessionId },
      }
    );
    await connected;
    expect(callbacks.connection).toHaveBeenCalledExactlyOnceWith('connected');
    await media.disconnect();
  });
  it('accepts a worker that joins with its readiness attribute set', async () => {
    const callbacks = events();
    const media = await createLivekitVoiceMedia(
      credentials,
      callbacks,
      microphone()
    );
    const connected = media.connect();
    await vi.waitFor(() => expect(fake.publishTrack).toHaveBeenCalled());
    fake.handlers.get('joined')?.({
      identity: credentials.agentIdentity,
      attributes: { 'macro.voice.ready': credentials.voiceSessionId },
    });
    await connected;
    expect(callbacks.connection).toHaveBeenCalledWith('connected');
    await media.disconnect();
  });
  it('resumes the existing conversation after a transient network reconnect', async () => {
    vi.useFakeTimers();
    const callbacks = events();
    const capture = microphone();
    const media = await createLivekitVoiceMedia(
      credentials,
      callbacks,
      capture
    );
    workerEvent(credentials.agentIdentity, 'ready');
    await media.connect();
    fake.handlers.get('reconnecting')?.();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(callbacks.failure).not.toHaveBeenCalled();
    expect(capture.stop).not.toHaveBeenCalled();
    fake.handlers.get('reconnected')?.();
    expect(callbacks.connection.mock.calls).toEqual([
      ['connected'],
      ['reconnecting'],
      ['connected'],
    ]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(callbacks.failure).not.toHaveBeenCalled();
    expect(fake.connect).toHaveBeenCalledOnce();
    await media.disconnect();
  });
  it('waits for the expected worker to rejoin and confirm the same voice session', async () => {
    vi.useFakeTimers();
    const callbacks = events();
    const capture = microphone();
    const media = await createLivekitVoiceMedia(
      credentials,
      callbacks,
      capture
    );
    workerEvent(credentials.agentIdentity, 'ready');
    await media.connect();
    fake.handlers.get('left')?.({ identity: 'unrelated' });
    expect(callbacks.connection).toHaveBeenCalledOnce();
    fake.handlers.get('left')?.({ identity: credentials.agentIdentity });
    await vi.advanceTimersByTimeAsync(40_000);
    fake.handlers.get('joined')?.({
      identity: credentials.agentIdentity,
      attributes: { 'macro.voice.ready': 'wrong-session' },
    });
    expect(callbacks.connection).toHaveBeenLastCalledWith('reconnecting');
    fake.handlers.get('joined')?.({
      identity: credentials.agentIdentity,
      attributes: { 'macro.voice.ready': credentials.voiceSessionId },
    });
    expect(callbacks.connection).toHaveBeenLastCalledWith('connected');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(callbacks.failure).not.toHaveBeenCalled();
    expect(capture.stop).not.toHaveBeenCalled();
    await media.disconnect();
  });
  it.each(['reconnecting', 'left'])(
    'ends only after the recovery grace expires for %s',
    async (event) => {
      vi.useFakeTimers();
      const callbacks = events();
      const capture = microphone();
      const media = await createLivekitVoiceMedia(
        credentials,
        callbacks,
        capture
      );
      workerEvent(credentials.agentIdentity, 'ready');
      await media.connect();
      fake.handlers.get(event)?.({ identity: credentials.agentIdentity });
      await vi.advanceTimersByTimeAsync(119_999);
      expect(callbacks.failure).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(callbacks.failure).toHaveBeenCalledOnce();
      expect(capture.stop).toHaveBeenCalled();
      await media.disconnect();
    }
  );
  it('surfaces a durable terminal reason from the initial room snapshot', async () => {
    fake.participants.set(credentials.agentIdentity, {
      identity: credentials.agentIdentity,
      attributes: {
        'macro.voice.status': JSON.stringify({
          version: 1,
          voiceSessionId: credentials.voiceSessionId,
          type: 'error',
          message: 'Provider session expired.',
        }),
      },
    });
    const callbacks = events();
    const media = await createLivekitVoiceMedia(
      credentials,
      callbacks,
      microphone()
    );
    await expect(media.connect()).rejects.toThrow('Provider session expired.');
    expect(callbacks.failure).toHaveBeenCalledExactlyOnceWith(
      'Provider session expired.'
    );
    expect(fake.publishTrack).not.toHaveBeenCalled();
  });
  it.each(['attributes', 'joined'])(
    'handles terminal worker status from %s without waiting for recovery timeout',
    async (event) => {
      const callbacks = events();
      const media = await createLivekitVoiceMedia(
        credentials,
        callbacks,
        microphone()
      );
      workerEvent(credentials.agentIdentity, 'ready');
      await media.connect();
      const participant = {
        identity: credentials.agentIdentity,
        attributes: {
          'macro.voice.status': JSON.stringify({
            version: 1,
            voiceSessionId: credentials.voiceSessionId,
            type: 'ended',
            message: 'The conversation ended.',
          }),
        },
      };
      if (event === 'attributes')
        fake.handlers.get(event)?.(participant.attributes, participant);
      else fake.handlers.get(event)?.(participant);
      expect(callbacks.failure).toHaveBeenCalledExactlyOnceWith(
        'The conversation ended.'
      );
      await media.disconnect();
    }
  );
  it('ignores durable terminal status from another worker or voice generation', async () => {
    const callbacks = events();
    const media = await createLivekitVoiceMedia(
      credentials,
      callbacks,
      microphone()
    );
    workerEvent(credentials.agentIdentity, 'ready');
    await media.connect();
    for (const [identity, voiceSessionId] of [
      ['untrusted', credentials.voiceSessionId],
      [credentials.agentIdentity, 'old-session'],
    ]) {
      const participant = {
        identity,
        attributes: {
          'macro.voice.status': JSON.stringify({
            version: 1,
            voiceSessionId,
            type: 'error',
            message: 'Stale failure',
          }),
        },
      };
      fake.handlers.get('attributes')?.(participant.attributes, participant);
    }
    expect(callbacks.failure).not.toHaveBeenCalled();
    await media.disconnect();
  });
  it('reconciles worker readiness when the SDK updates its snapshot without emitting the join event', async () => {
    vi.useFakeTimers();
    const callbacks = events();
    const media = await createLivekitVoiceMedia(
      credentials,
      callbacks,
      microphone()
    );
    workerEvent(credentials.agentIdentity, 'ready');
    await media.connect();
    fake.handlers.get('left')?.({ identity: credentials.agentIdentity });
    fake.participants.set(credentials.agentIdentity, {
      identity: credentials.agentIdentity,
      attributes: { 'macro.voice.ready': credentials.voiceSessionId },
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(callbacks.connection).toHaveBeenLastCalledWith('connected');
    expect(callbacks.failure).not.toHaveBeenCalled();
    await media.disconnect();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  VoiceBridge,
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
const taskId = '0195a574-e470-7a43-b74c-d06a7f374836';
const bridges = () =>
  ({
    request: vi.fn(),
    cancel: vi.fn(),
    context: vi.fn(),
    close: vi.fn(),
  }) satisfies VoiceBridge;
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
  it('accepts agent RPCs only from the dispatched worker identity', async () => {
    const bridge = bridges();
    bridge.request.mockResolvedValue({ taskId, status: 'accepted' });
    const media = await createLivekitVoiceMedia(
      credentials,
      events(),
      bridge,
      microphone()
    );
    const request = fake.rpc.get('macro.agent.request')!;
    const payload = JSON.stringify({
      version: 1,
      requestId: taskId,
      prompt: 'Find my draft',
    });
    await expect(
      request({ callerIdentity: 'untrusted', payload })
    ).rejects.toThrow('Unauthorized');
    expect(bridge.request).not.toHaveBeenCalled();
    await request({ callerIdentity: credentials.agentIdentity, payload });
    expect(bridge.request).toHaveBeenCalledOnce();
    await media.disconnect();
    await expect(
      request({ callerIdentity: credentials.agentIdentity, payload })
    ).rejects.toThrow('Unauthorized');
  });
  it('does not announce listening until the correct worker is ready', async () => {
    const callbacks = events();
    const media = await createLivekitVoiceMedia(
      credentials,
      callbacks,
      bridges(),
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
      bridges(),
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
  it('publishes ordered, bounded events to only the expected worker', async () => {
    const media = await createLivekitVoiceMedia(
      credentials,
      events(),
      bridges(),
      microphone()
    );
    await media.publish({
      version: 1,
      taskId,
      type: 'completed',
      text: 'Done',
    });
    const [bytes, destination] = fake.publish.mock.calls[0] as unknown as [
      Uint8Array,
      { destinationIdentities: string[] },
    ];
    expect(JSON.parse(new TextDecoder().decode(bytes))).toMatchObject({
      seq: 1,
      voiceSessionId: credentials.voiceSessionId,
    });
    expect(destination.destinationIdentities).toEqual([
      credentials.agentIdentity,
    ]);
    await expect(
      media.publish({
        version: 1,
        taskId,
        type: 'progress',
        text: '界'.repeat(6000),
      })
    ).rejects.toThrow('too large');
    expect(fake.publish).toHaveBeenCalledOnce();
    await media.disconnect();
  });
  it('publishes the granted track without opening a second microphone', async () => {
    const capture = microphone();
    const media = await createLivekitVoiceMedia(
      credentials,
      events(),
      bridges(),
      capture
    );
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
    const media = await createLivekitVoiceMedia(
      credentials,
      events(),
      bridges(),
      capture
    );
    await expect(media.connect()).rejects.toThrow('Network failed');
    expect(capture.stop).toHaveBeenCalled();
    expect(fake.publishTrack).not.toHaveBeenCalled();
    expect(fake.disconnect).toHaveBeenCalled();
  });
  it('releases microphone capture when track publication fails', async () => {
    fake.publishTrack.mockRejectedValueOnce(new Error('Publish failed'));
    const capture = microphone();
    const media = await createLivekitVoiceMedia(
      credentials,
      events(),
      bridges(),
      capture
    );
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
      bridges(),
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
      bridges(),
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
      bridges(),
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
      bridges(),
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
      bridges(),
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
      bridges(),
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
      bridges(),
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
});

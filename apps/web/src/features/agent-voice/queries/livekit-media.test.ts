import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  VoiceBridge,
  VoiceCredentials,
  VoiceMediaEvents,
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
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    microphone: vi.fn(async () => {}),
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
    localParticipant = {
      registerRpcMethod: (
        name: string,
        handler: typeof fake.rpc extends Map<string, infer H> ? H : never
      ) => fake.rpc.set(name, handler),
      unregisterRpcMethod: (name: string) => fake.rpc.delete(name),
      setMicrophoneEnabled: fake.microphone,
      getTrackPublication: () => undefined,
      publishData: fake.publish,
    };
    connect = fake.connect;
    disconnect = fake.disconnect;
    startAudio = async () => {};
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

beforeEach(() => {
  vi.clearAllMocks();
  fake.handlers.clear();
  fake.rpc.clear();
});
afterEach(() => vi.useRealTimers());

describe('LiveKit voice boundary', () => {
  it('accepts agent RPCs only from the dispatched worker identity', async () => {
    const bridge = bridges();
    bridge.request.mockResolvedValue({ taskId, status: 'accepted' });
    const media = await createLivekitVoiceMedia(credentials, events(), bridge);
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
      bridges()
    );
    const connected = media.connect();
    await vi.waitFor(() => expect(fake.microphone).toHaveBeenCalled());
    workerEvent('untrusted', 'ready');
    expect(callbacks.connection).not.toHaveBeenCalled();
    workerEvent(credentials.agentIdentity, 'ready');
    await connected;
    expect(callbacks.connection).toHaveBeenCalledExactlyOnceWith('connected');
    await media.disconnect();
  });
  it('ends an interrupted connect without enabling late microphone capture', async () => {
    let resolve!: () => void;
    fake.connect.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        })
    );
    const callbacks = events();
    const media = await createLivekitVoiceMedia(
      credentials,
      callbacks,
      bridges()
    );
    const connected = media.connect();
    await media.disconnect();
    resolve();
    await connected;
    expect(fake.microphone).not.toHaveBeenCalled();
    expect(callbacks.connection).not.toHaveBeenCalled();
  });
  it('publishes ordered, bounded events to only the expected worker', async () => {
    const media = await createLivekitVoiceMedia(
      credentials,
      events(),
      bridges()
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
});

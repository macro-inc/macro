import { Telemetry } from '@macro-inc/observability';
import type { CallTokenResponse } from '@service-call/client';
import type { Room, RoomOptions } from 'livekit-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const roomOptions = vi.fn();
const connectRoom = vi.fn<() => Promise<void>>();

vi.mock('livekit-client', () => ({
  Room: class {
    constructor(options: RoomOptions) {
      roomOptions(options);
    }
    localParticipant = {
      identity: 'local',
      isAgent: false,
      getTrackPublication: () => undefined,
    };
    remoteParticipants = new Map();
    on() {}
    removeAllListeners() {}
    connect = connectRoom;
    disconnect = vi.fn(async () => undefined);
  },
  RoomEvent: Object.fromEntries(
    [
      'ParticipantConnected',
      'ParticipantDisconnected',
      'TrackPublished',
      'TrackUnpublished',
      'TrackSubscribed',
      'TrackUnsubscribed',
      'TrackMuted',
      'TrackUnmuted',
      'LocalTrackPublished',
      'LocalTrackUnpublished',
      'ActiveSpeakersChanged',
    ].map((event) => [event, event.charAt(0).toLowerCase() + event.slice(1)])
  ),
  Track: { Source: { ScreenShare: 'screen_share', Microphone: 'microphone' } },
}));
vi.mock('../call-audio-receiver-stats', () => ({
  startReceiverStatsSampling: () => () => undefined,
}));

const { createLivekitJsCallController } = await import(
  '../LivekitJsCallController'
);

const token = {
  callId: 'call-1',
  channelId: null,
  serverUrl: 'wss://example.com',
  token: 'rtc-token',
} as unknown as CallTokenResponse;

function track() {
  return { stop: vi.fn() } as unknown as MediaStreamTrack & {
    stop: ReturnType<typeof vi.fn>;
  };
}

function setup(state?: { connectionState: string; room?: Room }) {
  let room: Room | null = state?.room ?? null;
  const setInitialMediaState = vi.fn();
  const finishLocalMediaSetup = vi.fn(async () => undefined);
  const controller = createLivekitJsCallController({
    room: () => room,
    setRoom: (next) => {
      room = next;
    },
    state: () =>
      ({
        activeChannelId: null,
        activeCallId: 'call-1',
        connectionState: state?.connectionState ?? 'disconnected',
      }) as never,
    currentMicrophoneCaptureOptions: () => ({}),
    isActiveConnectionState: (value) => value === 'connected',
    cancelPendingMediaSetup: () => undefined,
    nextMediaSetupVersion: () => 1,
    finishLocalMediaSetup,
    destroyProcessors: () => undefined,
    resetState: () => undefined,
    setConnectionState: () => undefined,
    setActiveCall: () => undefined,
    setDuplicateConnectCallId: () => undefined,
    setInitialMediaState,
    setRemoteParticipants: () => undefined,
    clearOptimisticJoin: () => undefined,
    bumpTrackVersion: () => undefined,
    bumpSpeakerVersion: () => undefined,
    setScreenSharing: () => undefined,
  });
  return { controller, finishLocalMediaSetup, setInitialMediaState };
}

describe('livekit call controller prejoin tracks', () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    connectRoom.mockReset();
    connectRoom.mockResolvedValue(undefined);
  });

  it('carries selected devices and background into the connected room', async () => {
    const { controller, setInitialMediaState } = setup();
    const preferences = {
      microphoneDeviceId: 'mic-2',
      cameraDeviceId: 'camera-2',
      speakerDeviceId: 'speaker-2',
      backgroundEffect: { type: 'blur' as const, intensity: 'medium' as const },
    };
    await controller.connect(token, preferences);
    expect(roomOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        audioCaptureDefaults: { deviceId: { exact: 'mic-2' } },
        videoCaptureDefaults: { deviceId: { exact: 'camera-2' } },
        audioOutput: { deviceId: 'speaker-2' },
      })
    );
    expect(setInitialMediaState).toHaveBeenCalledWith(preferences);
  });

  it('hands prejoin tracks to media setup instead of stopping them', async () => {
    const { controller, finishLocalMediaSetup } = setup();
    const localTracks = { microphone: track(), camera: track() };
    await controller.connect(token, { localTracks });
    expect(finishLocalMediaSetup).toHaveBeenCalledWith(
      expect.anything(),
      1,
      localTracks,
      expect.objectContaining({ span: expect.any(Function) })
    );
    expect(localTracks.microphone.stop).not.toHaveBeenCalled();
    expect(localTracks.camera.stop).not.toHaveBeenCalled();
  });

  it('explicitly parents background media after the asynchronous room connection', async () => {
    const connectionSpan = Telemetry.span('test');
    const phases = vi.spyOn(connectionSpan, 'span');
    vi.spyOn(Telemetry, 'span').mockReturnValue(connectionSpan);
    const { controller, finishLocalMediaSetup } = setup();

    await controller.connect(token);

    expect(phases).toHaveBeenCalledWith(
      'call.media.setup',
      expect.any(Function)
    );
    expect(finishLocalMediaSetup).toHaveBeenCalledWith(
      expect.anything(),
      1,
      undefined,
      expect.objectContaining({ span: expect.any(Function) })
    );
  });

  it('stops prejoin tracks when the room fails to connect', async () => {
    connectRoom.mockRejectedValue(new Error('offline'));
    const { controller, finishLocalMediaSetup } = setup();
    const localTracks = { microphone: track(), camera: track() };
    await expect(controller.connect(token, { localTracks })).rejects.toThrow(
      'offline'
    );
    expect(finishLocalMediaSetup).not.toHaveBeenCalled();
    expect(localTracks.microphone.stop).toHaveBeenCalledOnce();
    expect(localTracks.camera.stop).toHaveBeenCalledOnce();
  });

  it('stops prejoin tracks on a duplicate connect to the active room', async () => {
    const { controller, finishLocalMediaSetup } = setup({
      connectionState: 'connected',
      room: {} as Room,
    });
    const localTracks = { camera: track() };
    await controller.connect(token, { localTracks });
    expect(finishLocalMediaSetup).not.toHaveBeenCalled();
    expect(localTracks.camera.stop).toHaveBeenCalledOnce();
  });
});

const { startCallSpeakerDetection } = await import('../call-speaker-detection');

describe('visual call speaker detection', () => {
  let listeners: Map<string, Set<() => void>>;
  let local: {
    identity: string;
    isAgent: boolean;
    isSpeaking: boolean;
    publication?: {
      isMuted: boolean;
      isEnabled: boolean;
      audioTrack: { mediaStreamTrack: MediaStreamTrack };
    };
    getTrackPublication: () => unknown;
  };
  let remote: typeof local;
  let remoteParticipants: Map<string, typeof local>;
  let context: {
    state: AudioContextState;
    resume: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    createAnalyser: ReturnType<typeof vi.fn>;
    createMediaStreamSource: ReturnType<typeof vi.fn>;
  };
  let sources: Array<{
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }>;
  let analysers: Array<{
    fftSize: number;
    amplitude: number;
    offset: number;
    disconnect: ReturnType<typeof vi.fn>;
    getFloatTimeDomainData: (samples: Float32Array) => void;
  }>;
  let room: Room;
  let onChange: ReturnType<
    typeof vi.fn<(identities: ReadonlySet<string>) => void>
  >;

  beforeEach(() => {
    vi.useFakeTimers();
    listeners = new Map();
    sources = [];
    analysers = [];
    context = {
      state: 'running',
      resume: vi.fn(async () => {
        context.state = 'running';
      }),
      close: vi.fn(async () => {
        context.state = 'closed';
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      createAnalyser: vi.fn(() => {
        const analyser = {
          fftSize: 0,
          amplitude: 0,
          offset: 0,
          disconnect: vi.fn(),
          getFloatTimeDomainData: (samples: Float32Array) => {
            for (let i = 0; i < samples.length; i++) {
              samples[i] =
                analyser.offset +
                analyser.amplitude * Math.SQRT2 * Math.sin((i * Math.PI) / 16);
            }
          },
        };
        analysers.push(analyser);
        return analyser;
      }),
      createMediaStreamSource: vi.fn(() => {
        const source = { connect: vi.fn(), disconnect: vi.fn() };
        sources.push(source);
        return source;
      }),
    };
    vi.stubGlobal('AudioContext', function FakeAudioContext() {
      return context;
    });
    vi.stubGlobal(
      'MediaStream',
      class {
        constructor(public tracks: MediaStreamTrack[]) {}
      }
    );
    const localTrack = Object.assign(new EventTarget(), {
      enabled: true,
      readyState: 'live',
    }) as MediaStreamTrack;
    const remoteTrack = Object.assign(new EventTarget(), {
      enabled: true,
      readyState: 'live',
    }) as MediaStreamTrack;
    local = {
      identity: 'local',
      isAgent: false,
      isSpeaking: false,
      publication: {
        isMuted: false,
        isEnabled: true,
        audioTrack: { mediaStreamTrack: localTrack },
      },
      getTrackPublication() {
        return this.publication;
      },
    };
    remote = {
      identity: 'remote',
      isAgent: false,
      isSpeaking: false,
      publication: {
        isMuted: false,
        isEnabled: true,
        audioTrack: { mediaStreamTrack: remoteTrack },
      },
      getTrackPublication() {
        return this.publication;
      },
    };
    remoteParticipants = new Map([['remote', remote]]);
    room = {
      localParticipant: local,
      remoteParticipants,
      on(event: string, listener: () => void) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)?.add(listener);
      },
      off(event: string, listener: () => void) {
        listeners.get(event)?.delete(listener);
      },
    } as unknown as Room;
    onChange = vi.fn();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('detects quiet local and remote speech without routing audio to playback', () => {
    const stop = startCallSpeakerDetection(room, onChange);
    analysers[0].amplitude = 0.006;
    analysers[1].amplitude = 0.006;
    vi.advanceTimersByTime(50);
    expect(onChange).toHaveBeenLastCalledWith(new Set(['local', 'remote']));
    expect(sources).toHaveLength(2);
    expect(sources[0].connect).toHaveBeenCalledWith(analysers[0]);
    expect(analysers[0].disconnect).not.toHaveBeenCalled();
    analysers[0].amplitude = 0;
    analysers[1].amplitude = 0;
    vi.advanceTimersByTime(200);
    expect(onChange).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(50);
    expect(onChange).toHaveBeenLastCalledWith(new Set());
    stop();
  });

  it('ignores a constant microphone offset without losing quiet audio', () => {
    const stop = startCallSpeakerDetection(room, onChange);
    analysers[0].offset = 0.01;
    analysers[1].offset = -0.01;
    vi.advanceTimersByTime(50);
    expect(onChange).not.toHaveBeenCalled();

    analysers[0].amplitude = 0.006;
    vi.advanceTimersByTime(50);
    expect(onChange).toHaveBeenLastCalledWith(new Set(['local']));
    stop();
  });

  it('clears muted, disabled, ended, and agent tracks immediately', () => {
    const stop = startCallSpeakerDetection(room, onChange);
    analysers[1].amplitude = 0.006;
    vi.advanceTimersByTime(50);
    remote.publication!.isMuted = true;
    for (const listener of listeners.get('trackMuted') ?? []) listener();
    expect(onChange).toHaveBeenLastCalledWith(new Set());
    remote.publication!.isMuted = false;
    remote.publication!.isEnabled = false;
    for (const listener of listeners.get('trackUnmuted') ?? []) listener();
    expect(sources[1].disconnect).toHaveBeenCalledOnce();
    remote.publication!.isEnabled = true;
    remote.publication!.audioTrack.mediaStreamTrack.enabled = false;
    vi.advanceTimersByTime(50);
    expect(sources).toHaveLength(2);
    remote.publication!.audioTrack.mediaStreamTrack.enabled = true;
    remote.isAgent = true;
    vi.advanceTimersByTime(50);
    expect(sources).toHaveLength(2);
    remote.isAgent = false;
    vi.advanceTimersByTime(50);
    analysers[2].amplitude = 0.006;
    vi.advanceTimersByTime(50);
    const track = remote.publication!.audioTrack.mediaStreamTrack;
    Object.defineProperty(track, 'readyState', { value: 'ended' });
    track.dispatchEvent(new Event('ended'));
    expect(onChange).toHaveBeenLastCalledWith(new Set());
    stop();
  });

  it('resets the release hold on replacement and clears removed participants', () => {
    const stop = startCallSpeakerDetection(room, onChange);
    analysers[1].amplitude = 0.006;
    vi.advanceTimersByTime(50);
    const replacement = Object.assign(new EventTarget(), {
      enabled: true,
      readyState: 'live',
    }) as MediaStreamTrack;
    remote.publication!.audioTrack.mediaStreamTrack = replacement;
    for (const listener of listeners.get('trackSubscribed') ?? []) listener();
    expect(onChange).toHaveBeenLastCalledWith(new Set());
    expect(sources[1].disconnect).toHaveBeenCalledOnce();
    analysers[2].amplitude = 0.006;
    vi.advanceTimersByTime(50);
    remoteParticipants.delete('remote');
    for (const listener of listeners.get('participantDisconnected') ?? [])
      listener();
    expect(onChange).toHaveBeenLastCalledWith(new Set());
    expect(sources[2].disconnect).toHaveBeenCalledOnce();
    stop();
  });

  it('uses SDK speaking only when analysis is unavailable or suspended', async () => {
    context.state = 'suspended';
    local.isSpeaking = true;
    const added = vi.spyOn(document, 'addEventListener');
    const stop = startCallSpeakerDetection(room, onChange);
    expect(onChange).toHaveBeenLastCalledWith(new Set(['local']));
    expect(context.resume).toHaveBeenCalledOnce();
    context.resume.mockClear();
    context.state = 'running';
    vi.advanceTimersByTime(50);
    expect(onChange).toHaveBeenLastCalledWith(new Set());
    context.state = 'suspended';
    const interaction = added.mock.calls.find(
      ([event]) => event === 'pointerdown'
    )?.[1] as EventListener;
    interaction({ isTrusted: false } as Event);
    expect(context.resume).not.toHaveBeenCalled();
    interaction({ isTrusted: true } as Event);
    await Promise.resolve();
    expect(context.resume).toHaveBeenCalledOnce();
    added.mockRestore();
    stop();
    vi.stubGlobal('AudioContext', undefined);
    local.isSpeaking = true;
    const fallback = startCallSpeakerDetection(room, onChange);
    expect(onChange).toHaveBeenLastCalledWith(new Set(['local']));
    local.publication!.isMuted = true;
    for (const listener of listeners.get('trackMuted') ?? []) listener();
    expect(onChange).toHaveBeenLastCalledWith(new Set());
    fallback();
  });

  it('uses SDK speaking during remote unsubscribe without reviving muted microphones', () => {
    const stop = startCallSpeakerDetection(room, onChange);
    const publication = { isMuted: false, isEnabled: true };
    remote.getTrackPublication = () => publication;
    remote.isSpeaking = true;
    for (const listener of listeners.get('trackUnsubscribed') ?? []) listener();
    expect(onChange).toHaveBeenLastCalledWith(new Set(['remote']));
    expect(sources[1].disconnect).toHaveBeenCalledOnce();

    remote.isSpeaking = false;
    for (const listener of listeners.get('activeSpeakersChanged') ?? [])
      listener();
    expect(onChange).toHaveBeenLastCalledWith(new Set());
    remote.isSpeaking = true;
    publication.isMuted = true;
    for (const listener of listeners.get('trackMuted') ?? []) listener();
    expect(onChange).toHaveBeenCalledTimes(2);
    publication.isMuted = false;
    publication.isEnabled = false;
    vi.advanceTimersByTime(50);
    expect(onChange).toHaveBeenCalledTimes(2);

    remote.getTrackPublication = () => remote.publication;
    for (const listener of listeners.get('trackSubscribed') ?? []) listener();
    expect(sources).toHaveLength(3);
    expect(onChange).toHaveBeenCalledTimes(2);
    stop();
  });

  it('retries suspended analysis when the visible tab or microphone returns', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const stop = startCallSpeakerDetection(room, onChange);
    context.state = 'suspended';
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(context.resume).not.toHaveBeenCalled();

    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(context.resume).toHaveBeenCalledOnce();
    expect(context.state).toBe('running');

    context.state = 'suspended';
    for (const listener of listeners.get('localTrackPublished') ?? [])
      listener();
    await Promise.resolve();
    expect(context.resume).toHaveBeenCalledTimes(2);
    stop();
    context.state = 'suspended';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(context.resume).toHaveBeenCalledTimes(2);
  });

  it('does not restore held speech after analysis was suspended', () => {
    const stop = startCallSpeakerDetection(room, onChange);
    analysers[0].amplitude = 0.006;
    vi.advanceTimersByTime(50);
    expect(onChange).toHaveBeenLastCalledWith(new Set(['local']));

    context.state = 'suspended';
    analysers[0].amplitude = 0;
    vi.advanceTimersByTime(50);
    expect(onChange).toHaveBeenLastCalledWith(new Set());
    context.state = 'running';
    vi.advanceTimersByTime(50);
    expect(onChange).toHaveBeenCalledTimes(2);
    stop();
  });

  it('uses SDK speaking for an input that Web Audio cannot connect', () => {
    context.createMediaStreamSource.mockImplementationOnce(() => {
      throw new Error('unavailable');
    });
    local.isSpeaking = true;
    const stop = startCallSpeakerDetection(room, onChange);
    expect(onChange).toHaveBeenLastCalledWith(new Set(['local']));
    remote.isSpeaking = true;
    vi.advanceTimersByTime(50);
    expect(onChange).toHaveBeenLastCalledWith(new Set(['local']));
    stop();
  });

  it('disposes listeners, nodes, timers, and its context once', () => {
    const stop = startCallSpeakerDetection(room, onChange);
    stop();
    stop();
    expect(context.close).toHaveBeenCalledOnce();
    expect(context.removeEventListener).toHaveBeenCalledOnce();
    expect(
      sources.every((source) => source.disconnect.mock.calls.length === 1)
    ).toBe(true);
    expect(
      [...listeners.values()].every((callbacks) => callbacks.size === 0)
    ).toBe(true);
    vi.advanceTimersByTime(500);
    expect(onChange).not.toHaveBeenCalled();
  });
});

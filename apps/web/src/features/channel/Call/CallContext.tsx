import { analytics } from '@app/lib/analytics';
import type { KrispNoiseFilter } from '@livekit/krisp-noise-filter';
import type { BackgroundProcessorWrapper } from '@livekit/track-processors';
import type { CallTokenResponse } from '@service-call/client';
import { makePersisted } from '@solid-primitives/storage';
import type {
  AudioCaptureOptions,
  ConnectionState,
  LocalTrack,
  RemoteParticipant,
  Room,
} from 'livekit-client';
import {
  createContext,
  createSignal,
  onCleanup,
  type ParentProps,
  useContext,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { CallAudioSink } from './CallAudioSink';
import {
  type CallSessionConnectMetadata,
  type CallSessionDisconnectOptions,
  createCallSessionController,
} from './CallSessionController';
import {
  getKrisp,
  getLivekit,
  isKrispSupported,
  LK_CONNECTION_STATE,
  LK_TRACK_SOURCE,
  loadKrisp,
  loadLivekit,
} from './livekit-loader';
import {
  type NativeCallConnectionState,
  useMaybeNativeCallState,
} from './native-call-state';

type LivekitJsCallController = ReturnType<
  typeof import('./LivekitJsCallController')['createLivekitJsCallController']
>;
type LivekitJsCallControllerOptions = Parameters<
  typeof import('./LivekitJsCallController')['createLivekitJsCallController']
>[0];

export type CallParticipantInfo = {
  identity: string;
  isSpeaking: boolean;
  isMuted: boolean;
  hasVideo: boolean;
};

export type MediaDeviceInfo = {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
};

export type BlurIntensity = 'light' | 'medium' | 'heavy';

export type BackgroundEffect =
  | { type: 'none' }
  | { type: 'blur'; intensity: BlurIntensity }
  | { type: 'image'; id: string; path: string };

export const BLUR_RADIUS: Record<BlurIntensity, number> = {
  light: 5,
  medium: 10,
  heavy: 20,
};

type ImageBackgroundEffect = Extract<BackgroundEffect, { type: 'image' }>;

export const BACKGROUND_IMAGES: (ImageBackgroundEffect & { label: string })[] =
  [];

export type MicNoiseSuppressionMode = 'off' | 'browser' | 'krisp';

type NativeAudioProcessingConstraints = MediaTrackConstraints & {
  voiceIsolation?: ConstrainBoolean;
};

type NativeAudioProcessingSettings = MediaTrackSettings & {
  autoGainControl?: boolean;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  voiceIsolation?: boolean;
};

type NativeAudioProcessingSupportedConstraints =
  MediaTrackSupportedConstraints & {
    voiceIsolation?: boolean;
  };

function supportedNativeAudioProcessingConstraints(): NativeAudioProcessingSupportedConstraints | null {
  return (
    (navigator.mediaDevices?.getSupportedConstraints?.() as
      | NativeAudioProcessingSupportedConstraints
      | undefined) ?? null
  );
}

function supportsNativeAudioProcessingConstraint(
  name: keyof NativeAudioProcessingSupportedConstraints
): boolean {
  const supported = supportedNativeAudioProcessingConstraints();
  if (!supported) return name !== 'voiceIsolation';
  return supported[name] === true;
}

function normalizeNoiseSuppressionMode(
  value: unknown
): MicNoiseSuppressionMode {
  if (value === false || value === 'false' || value === 'off') return 'off';
  if (value === 'browser') return 'browser';
  return 'krisp';
}

function effectiveCaptureModeForPreferredMode(
  mode: MicNoiseSuppressionMode
): MicNoiseSuppressionMode {
  if (mode === 'krisp' && !isKrispSupported()) return 'browser';
  return mode;
}

function isNoiseSuppressionEnabled(mode: MicNoiseSuppressionMode): boolean {
  return mode !== 'off';
}

function microphoneCaptureOptions(
  mode: MicNoiseSuppressionMode,
  deviceId?: string | null
): AudioCaptureOptions {
  const useBrowserProcessing = mode === 'browser';
  const noiseSuppressionSupported =
    supportsNativeAudioProcessingConstraint('noiseSuppression');

  return {
    // Browser AGC runs inside the capture pipeline (AEC → AGC → NS), i.e.
    // upstream of any track processor — it feeds Krisp a healthy input level
    // and cannot re-amplify the filter's residue (that would need a gain
    // stage after the processor, which doesn't exist here). AGC-off left
    // quiet mics at low SNR, and Krisp/browser NS then gated their speech.
    ...(supportsNativeAudioProcessingConstraint('autoGainControl')
      ? { autoGainControl: true }
      : {}),
    echoCancellation: true,
    ...(noiseSuppressionSupported
      ? { noiseSuppression: useBrowserProcessing }
      : {}),
    // Voice isolation is a second, platform-level suppression stage; running
    // it on top of noiseSuppression cascades filters and attenuates voice.
    // Use it only as the fallback when noiseSuppression is unsupported.
    ...(supportsNativeAudioProcessingConstraint('voiceIsolation')
      ? { voiceIsolation: useBrowserProcessing && !noiseSuppressionSupported }
      : {}),
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  };
}

function nativeAudioProcessingConstraints(
  mode: MicNoiseSuppressionMode
): NativeAudioProcessingConstraints {
  const useBrowserProcessing = mode === 'browser';
  const noiseSuppressionSupported =
    supportsNativeAudioProcessingConstraint('noiseSuppression');

  return {
    // applyConstraints() replaces the track's entire constraint set, so echo
    // cancellation must be restated here or every mode change silently drops
    // it back to unconstrained.
    echoCancellation: true,
    // AGC stays on in every mode — see microphoneCaptureOptions.
    ...(supportsNativeAudioProcessingConstraint('autoGainControl')
      ? { autoGainControl: true }
      : {}),
    ...(noiseSuppressionSupported
      ? { noiseSuppression: useBrowserProcessing }
      : {}),
    // See microphoneCaptureOptions: voiceIsolation is only the fallback when
    // noiseSuppression is unsupported, never a second stacked layer.
    ...(supportsNativeAudioProcessingConstraint('voiceIsolation')
      ? { voiceIsolation: useBrowserProcessing && !noiseSuppressionSupported }
      : {}),
  };
}

function getLocalMicTrack(r: Room): LocalTrack | undefined {
  return r.localParticipant.getTrackPublication(LK_TRACK_SOURCE.Microphone)
    ?.track as LocalTrack | undefined;
}

function isActiveCallConnectionState(state: ConnectionState): boolean {
  return (
    state === LK_CONNECTION_STATE.Connecting ||
    state === LK_CONNECTION_STATE.Connected ||
    state === LK_CONNECTION_STATE.Reconnecting ||
    state === LK_CONNECTION_STATE.SignalReconnecting
  );
}

function isLiveLocalTrack(
  track: LocalTrack | null | undefined
): track is LocalTrack {
  return track?.mediaStreamTrack?.readyState === 'live';
}

async function applyNativeAudioProcessingToMicTrack(
  r: Room,
  mode: MicNoiseSuppressionMode
) {
  const mediaStreamTrack = getLocalMicTrack(r)?.mediaStreamTrack;
  if (!mediaStreamTrack || mediaStreamTrack.readyState === 'ended') return;

  try {
    await mediaStreamTrack.applyConstraints(
      nativeAudioProcessingConstraints(mode)
    );
  } catch (e) {
    console.error('failed to update native mic audio processing', e);
  }
}

// Swift exposes a transient `disconnecting` state that livekit-client lacks.
const NATIVE_TO_LIVEKIT_STATE = {
  disconnected: LK_CONNECTION_STATE.Disconnected,
  connecting: LK_CONNECTION_STATE.Connecting,
  connected: LK_CONNECTION_STATE.Connected,
  reconnecting: LK_CONNECTION_STATE.Reconnecting,
  disconnecting: LK_CONNECTION_STATE.Disconnected,
} satisfies Record<NativeCallConnectionState, ConnectionState>;

type CallStoreState = {
  connectionState: ConnectionState;
  activeChannelId: string | null;
  activeCallId: string | null;
  remoteParticipants: Map<string, RemoteParticipant>;
  isAudioMuted: boolean;
  isVideoMuted: boolean;
  isScreenSharing: boolean;
  trackVersion: number;
  speakerVersion: number;
  audioInputDevices: MediaDeviceInfo[];
  audioOutputDevices: MediaDeviceInfo[];
  videoInputDevices: MediaDeviceInfo[];
  activeAudioInputDeviceId: string | null;
  activeAudioOutputDeviceId: string | null;
  activeVideoInputDeviceId: string | null;
  noiseSuppressionMode: MicNoiseSuppressionMode;
  optimisticJoinChannelId: string | null;
  joinError: string | null;
  /** Which channel block has the Call tab selected (synced from channel UI). */
  callPageChannelId: string | null;
  backgroundEffect: BackgroundEffect;
  // Mirrors the call's `share_with_team` flag. Defaults to true to match the
  // server-side default for newly-created calls; synced from the toggle
  // endpoint's response on each flip.
  isSharedWithTeam: boolean;
};

const initialState: CallStoreState = {
  connectionState: LK_CONNECTION_STATE.Disconnected,
  activeChannelId: null,
  activeCallId: null,
  remoteParticipants: new Map(),
  isAudioMuted: false,
  isVideoMuted: true,
  isScreenSharing: false,
  trackVersion: 0,
  speakerVersion: 0,
  audioInputDevices: [],
  audioOutputDevices: [],
  videoInputDevices: [],
  activeAudioInputDeviceId: null,
  activeAudioOutputDeviceId: null,
  activeVideoInputDeviceId: null,
  noiseSuppressionMode: 'off',
  optimisticJoinChannelId: null,
  joinError: null,
  callPageChannelId: null,
  backgroundEffect: { type: 'none' },
  isSharedWithTeam: true,
};

// Persisted across reloads — background effect is a privacy preference users
// expect to stick. Feature-detect at attach time; an unsupported browser
// simply ignores a stored value.
const [persistedBackgroundEffect, setPersistedBackgroundEffect] = makePersisted(
  createSignal<BackgroundEffect>({ type: 'none' }),
  {
    name: 'call.backgroundEffect',
    // This custom deserialize is to handle the previous boolean format
    deserialize(data) {
      try {
        const value = JSON.parse(data);

        if (typeof value === 'boolean') {
          return value
            ? { type: 'blur', intensity: 'light' }
            : { type: 'none' };
        }

        return value;
      } catch {
        return { type: 'none' };
      }
    },
  }
);

// Persisted across reloads — users with hardware noise cancellation (e.g.
// AirPods Pro, Bose) need to disable app/browser-side NS to avoid cascading
// filters that attenuate voice. Defaults to Krisp to match existing behavior.
// The custom deserializer migrates the previous boolean format.
const [persistedNoiseSuppressionMode, setPersistedNoiseSuppressionMode] =
  makePersisted(createSignal<MicNoiseSuppressionMode>('krisp'), {
    name: 'call.noiseSuppression',
    deserialize(data) {
      try {
        return normalizeNoiseSuppressionMode(JSON.parse(data));
      } catch {
        return normalizeNoiseSuppressionMode(data);
      }
    },
  });

export type CallState = {
  /** The LiveKit Room instance, null when not in a call */
  room: () => Room | null;
  /** Current connection state */
  connectionState: () => ConnectionState;
  /** Whether the local user is currently in a call */
  isInCall: () => boolean;
  /** Channel ID of the active call */
  activeChannelId: () => string | null;
  /** Call ID of the active call (from CallTokenResponse) */
  activeCallId: () => string | null;
  /** Remote participants in the call */
  remoteParticipants: () => Map<string, RemoteParticipant>;
  /** Incremented when track subscription/mute state changes */
  trackVersion: () => number;
  /** Whether the local participant is currently speaking */
  isLocalSpeaking: () => boolean;
  /** Whether a remote participant is currently speaking (reactive) */
  isParticipantSpeaking: (participant: RemoteParticipant) => boolean;
  /** Whether local audio is muted */
  isAudioMuted: () => boolean;
  /** Whether local video is muted */
  isVideoMuted: () => boolean;
  /** Whether local screen share is active */
  isScreenSharing: () => boolean;
  /** Available audio input devices (microphones) */
  audioInputDevices: () => MediaDeviceInfo[];
  /** Available audio output devices (speakers) */
  audioOutputDevices: () => MediaDeviceInfo[];
  /** Available video input devices (cameras) */
  videoInputDevices: () => MediaDeviceInfo[];
  /** Currently active audio input device ID */
  activeAudioInputDeviceId: () => string | null;
  /** Currently active audio output device ID */
  activeAudioOutputDeviceId: () => string | null;
  /** Currently active video input device ID */
  activeVideoInputDeviceId: () => string | null;
  /** Whether joining this channel needs a fresh call token */
  shouldRequestSessionToken: (channelId: string) => boolean;
  /** Connect the active call session using the right platform controller */
  connectSession: (
    tokenResponse: CallTokenResponse,
    metadata?: CallSessionConnectMetadata
  ) => Promise<void>;
  /** Disconnect the active call session using the right platform controller */
  disconnectSession: (options?: CallSessionDisconnectOptions) => Promise<void>;
  /** Toggle local audio */
  toggleAudio: () => Promise<void>;
  /** Toggle local video */
  toggleVideo: () => Promise<void>;
  /** Toggle screen sharing */
  toggleScreenShare: () => Promise<void>;
  /** Switch active audio input device */
  switchAudioInput: (deviceId: string) => Promise<void>;
  /** Switch active audio output device */
  switchAudioOutput: (deviceId: string) => Promise<void>;
  /** Switch active video input device */
  switchVideoInput: (deviceId: string) => Promise<void>;
  /** Active mic noise suppression mode: off, browser-native, or Krisp */
  noiseSuppressionMode: () => MicNoiseSuppressionMode;
  /** Whether mic noise suppression (Krisp or native fallback) is enabled */
  isNoiseSuppressed: () => boolean;
  /** Toggle mic noise suppression on/off */
  toggleNoiseSuppression: () => Promise<void>;
  /** Begin an optimistic join to a channel */
  beginOptimisticJoin: (channelId: string) => void;
  /** Rollback an optimistic join to a channel */
  rollbackOptimisticJoin: () => void;
  /** Whether we're in the optimistic join window */
  isConnecting: () => boolean;
  /** Error message from a failed join attempt */
  joinError: () => string | null;
  /** Set the join error message */
  setJoinError: (error: string | null) => void;
  /**
   * Which channel has the Call tab focused in a channel split. `null` when no
   * channel block reports the Call tab.
   */
  callPageChannelId: () => string | null;
  /**
   * Channel blocks call this when the tab strip changes.
   */
  syncCallPageTab: (channelId: string, isCallTab: boolean) => void;
  /**
   * True when the active call and call-page channel match.
   */
  isCallPage: () => boolean;
  /** Current background effect (none, blur, or image) */
  backgroundEffect: () => BackgroundEffect;
  /** Set the background effect (blur with intensity or image background) */
  setBackgroundEffect: (effect: BackgroundEffect) => Promise<void>;
  /** Whether the call is currently shared with the creator's team */
  isSharedWithTeam: () => boolean;
  /** Update the locally-cached share-with-team flag (call after a toggle RPC) */
  setSharedWithTeam: (value: boolean) => void;
};

const CallContext = createContext<CallState>();

export function useCallContext(): CallState {
  const ctx = useContext(CallContext);
  if (!ctx) {
    throw new Error('useCallContext must be used within <CallProvider />');
  }
  return ctx;
}

export function useCallContextOptional(): CallState | undefined {
  return useContext(CallContext);
}

/**
 * Primitive that manages the LiveKit room lifecycle, event listeners,
 * and all readonly call state. Returns reactive state + mutation actions.
 */
function createCallState() {
  const nativeCall = useMaybeNativeCallState();
  const [room, setRoom] = createSignal<Room | null>(null);
  const [store, setStore] = createStore<CallStoreState>({
    ...initialState,
    backgroundEffect: persistedBackgroundEffect(),
    noiseSuppressionMode: persistedNoiseSuppressionMode(),
  });
  const [krispFilter, setKrispFilter] = createSignal<ReturnType<
    typeof KrispNoiseFilter
  > | null>(null);
  const [blurProcessor, setBlurProcessor] =
    createSignal<BackgroundProcessorWrapper | null>(null);

  let mediaSetupVersion = 0;

  function nextMediaSetupVersion() {
    mediaSetupVersion += 1;
    return mediaSetupVersion;
  }

  function cancelPendingMediaSetup() {
    mediaSetupVersion += 1;
  }

  function isCurrentMediaSetup(targetRoom: Room, setupVersion: number) {
    return room() === targetRoom && mediaSetupVersion === setupVersion;
  }

  const currentNativeCallSnapshot = () => nativeCall?.snapshot() ?? null;

  function currentMicrophoneCaptureOptions(
    deviceId?: string | null
  ): AudioCaptureOptions {
    return microphoneCaptureOptions(
      effectiveCaptureModeForPreferredMode(persistedNoiseSuppressionMode()),
      deviceId
    );
  }

  function logMicAudioProcessing(
    event: string,
    r: Room,
    extra?: Record<string, unknown>
  ) {
    const micTrack = getLocalMicTrack(r);
    const mediaStreamTrack = micTrack?.mediaStreamTrack;
    const settings = mediaStreamTrack?.getSettings() as
      | NativeAudioProcessingSettings
      | undefined;
    const constraints = mediaStreamTrack?.getConstraints() as
      | NativeAudioProcessingConstraints
      | undefined;

    // A requested constraint the engine reports back differently in settings
    // means the processing state was never actually applied (live-track
    // applyConstraints is not honored everywhere) — the key signal behind
    // "toggled noise suppression and nothing changed" reports.
    const constraintMismatch = (
      ['autoGainControl', 'echoCancellation', 'noiseSuppression'] as const
    ).some((name) => {
      const requested = constraints?.[name];
      return (
        typeof requested === 'boolean' &&
        settings?.[name] !== undefined &&
        settings[name] !== requested
      );
    });

    console.debug('[call] mic audio processing', {
      event,
      preferredMode: persistedNoiseSuppressionMode(),
      activeMode: store.noiseSuppressionMode,
      krispSupported: isKrispSupported(),
      hasMicTrack: !!micTrack,
      micReadyState: mediaStreamTrack?.readyState,
      hasProcessor: !!micTrack?.getProcessor(),
      constraintMismatch,
      settings: {
        autoGainControl: settings?.autoGainControl,
        echoCancellation: settings?.echoCancellation,
        noiseSuppression: settings?.noiseSuppression,
        voiceIsolation: settings?.voiceIsolation,
        channelCount: settings?.channelCount,
        sampleRate: settings?.sampleRate,
      },
      constraints: {
        autoGainControl: constraints?.autoGainControl,
        echoCancellation: constraints?.echoCancellation,
        noiseSuppression: constraints?.noiseSuppression,
        voiceIsolation: constraints?.voiceIsolation,
      },
      ...extra,
    });

    analytics.track('call_audio_processing', {
      event,
      channelId: store.activeChannelId ?? '',
      callId: store.activeCallId ?? undefined,
      preferredMode: persistedNoiseSuppressionMode(),
      activeMode: store.noiseSuppressionMode,
      krispSupported: isKrispSupported(),
      hasProcessor: !!micTrack?.getProcessor(),
      constraintMismatch,
      autoGainControl: settings?.autoGainControl,
      echoCancellation: settings?.echoCancellation,
      noiseSuppression: settings?.noiseSuppression,
      voiceIsolation: settings?.voiceIsolation,
      channelCount: settings?.channelCount,
      sampleRate: settings?.sampleRate,
      ...extra,
    });
  }

  // --- internal helpers ---

  // Noise-suppression processor work can be reached concurrently (background
  // media setup, mute toggle, device switch, NS toggle). Overlapping runs can
  // attach duplicate Krisp instances or land an attach after the user toggled
  // off, so it is serialized; each queued run re-reads the persisted mode,
  // which means the latest user intent wins regardless of arrival order.
  let micProcessingQueue: Promise<void> = Promise.resolve();

  function enqueueMicProcessing<T>(task: () => Promise<T>): Promise<T> {
    const run = micProcessingQueue.then(task);
    micProcessingQueue = run.then(
      () => {},
      () => {}
    );
    return run;
  }

  /** Apply the preferred mic noise suppression mode to the current mic track. */
  function ensureNoiseSuppressionOnMicTrack(r: Room): Promise<void> {
    return enqueueMicProcessing(() => applyNoiseSuppressionToMicTrack(r));
  }

  /** Serialized body of ensureNoiseSuppressionOnMicTrack — do not call directly. */
  async function applyNoiseSuppressionToMicTrack(r: Room) {
    if (room() !== r) return;

    const preferredMode = persistedNoiseSuppressionMode();

    if (preferredMode === 'off') {
      setStore('noiseSuppressionMode', 'off');
      await detachKrispFromMicTrack(r);
      if (room() !== r) return;
      await applyNativeAudioProcessingToMicTrack(r, 'off');
      if (room() !== r) return;
      logMicAudioProcessing('noise-suppression-off', r);
      return;
    }

    const micTrack = getLocalMicTrack(r);
    if (!isLiveLocalTrack(micTrack)) return;

    if (preferredMode === 'browser') {
      setStore('noiseSuppressionMode', 'browser');
      await detachKrispFromMicTrack(r);
      if (room() !== r) return;
      await applyNativeAudioProcessingToMicTrack(r, 'browser');
      if (room() !== r) return;
      logMicAudioProcessing('browser-noise-suppression-enabled', r, {
        reason: 'preferred',
      });
      return;
    }

    // Resolve Krisp before deciding whether the persisted preference can be
    // honored. Import/load failures intentionally fall back to browser-native
    // processing instead of failing call setup.
    await loadKrisp().catch(() => null);
    if (room() !== r || !isLiveLocalTrack(micTrack)) return;

    const krispModule = getKrisp();
    if (!krispModule || !krispModule.isKrispNoiseFilterSupported()) {
      setStore('noiseSuppressionMode', 'browser');
      await detachKrispFromMicTrack(r);
      if (room() !== r) return;
      await applyNativeAudioProcessingToMicTrack(r, 'browser');
      if (room() !== r) return;
      logMicAudioProcessing('browser-noise-suppression-enabled', r, {
        reason: 'krisp-unsupported',
      });
      return;
    }

    const existing = krispFilter();
    if (existing && micTrack.getProcessor() === existing) {
      await applyNativeAudioProcessingToMicTrack(r, 'krisp');
      if (room() !== r || !isLiveLocalTrack(micTrack)) return;
      await existing.setEnabled(true);
      setStore('noiseSuppressionMode', 'krisp');
      logMicAudioProcessing('krisp-noise-suppression-reused', r);
      return;
    }

    // Krisp should be the only noise suppression layer. Disable native browser
    // NS / voice isolation / AGC before attaching it to avoid cascaded filters.
    await applyNativeAudioProcessingToMicTrack(r, 'krisp');
    if (room() !== r || !isLiveLocalTrack(micTrack)) return;

    try {
      await detachKrispFromMicTrack(r);
      if (room() !== r || !isLiveLocalTrack(micTrack)) return;

      // `quality` is model size/CPU cost, not suppression strength. The default
      // medium model avoids the CPU pressure/dropouts that made voices sound
      // muddy on busy machines while still enabling Krisp when supported.
      const krisp = krispModule.KrispNoiseFilter({ quality: 'medium' });
      setKrispFilter(krisp);
      await micTrack.setProcessor(krisp);
      if (room() !== r || !isLiveLocalTrack(micTrack)) {
        // The room/track went away mid-attach. Destroying a processor that
        // is still wired into the track's audio graph leaves a dead node in
        // the pipeline — detach it via stopProcessor() instead (which
        // destroys the processor internally).
        if (micTrack.getProcessor() === krisp) {
          await micTrack.stopProcessor();
        } else {
          await krisp.destroy();
        }
        if (krispFilter() === krisp) setKrispFilter(null);
        return;
      }
      await krisp.setEnabled(true);
      setStore('noiseSuppressionMode', 'krisp');
      logMicAudioProcessing('krisp-noise-suppression-attached', r);
    } catch (e) {
      if (room() !== r) return;
      console.error('failed to re-attach Krisp noise filter', e);
      // Fall back to a single browser-native layer if Krisp fails.
      await detachKrispFromMicTrack(r);
      if (room() !== r) return;
      setStore('noiseSuppressionMode', 'browser');
      await applyNativeAudioProcessingToMicTrack(r, 'browser');
      if (room() !== r) return;
      logMicAudioProcessing('browser-noise-suppression-fallback', r, {
        reason: 'krisp-attach-failed',
      });
    }
  }

  /** Stop + destroy the Krisp processor on the current mic track. */
  async function detachKrispFromMicTrack(r: Room) {
    const prev = krispFilter();
    if (!prev) return;

    try {
      const micTrack = getLocalMicTrack(r);
      if (micTrack?.getProcessor() === prev) {
        // stopProcessor() calls the processor's destroy() internally.
        await micTrack.stopProcessor();
      } else {
        await prev.destroy();
      }
      setKrispFilter(null);
    } catch (e) {
      console.error('failed to detach Krisp noise filter', e);
    }
  }

  /**
   * (Re-)attach the background effect processor to the current camera track.
   * Dynamic-imports @livekit/track-processors so the MediaPipe WASM/model
   * payload is only fetched when the user actually enables an effect.
   *
   * If a processor already exists and forceRecreate is false, uses switchTo()
   * for seamless transitions. When the track changes (camera switch, video
   * toggle), pass forceRecreate=true to destroy and recreate the processor.
   *
   * Returns true on success or when there's no live camera track yet (the
   * processor will be attached later by the video-(un)mute / device-switch
   * paths). Returns false when the browser does not actually support the
   * processor at runtime, or attachment throws — callers that set
   * backgroundEffect optimistically should revert it in that case.
   */
  async function ensureBackgroundEffectOnCameraTrack(
    r: Room,
    forceRecreate = false
  ): Promise<boolean> {
    const effect = store.backgroundEffect;
    if (effect.type === 'none') return true;

    const camPub = r.localParticipant.getTrackPublication(
      LK_TRACK_SOURCE.Camera
    );
    const camTrack = camPub?.track as LocalTrack | undefined;
    if (!isLiveLocalTrack(camTrack)) return true;

    const processorOptions =
      effect.type === 'blur'
        ? {
            mode: 'background-blur' as const,
            blurRadius: BLUR_RADIUS[effect.intensity],
          }
        : { mode: 'virtual-background' as const, imagePath: effect.path };

    try {
      if (room() !== r || !isLiveLocalTrack(camTrack)) return true;

      const existing = blurProcessor();

      // If we have a processor and the track hasn't changed, use switchTo()
      // for a seamless transition without destroying and recreating.
      if (existing && !forceRecreate) {
        await existing.switchTo(processorOptions);
        return true;
      }

      // Destroy old processor if it exists (track changed or force recreate)
      if (existing) {
        await existing.destroy();
        if (blurProcessor() === existing) setBlurProcessor(null);
      }

      if (room() !== r || !isLiveLocalTrack(camTrack)) return true;

      // Create and attach a new processor.
      const { BackgroundProcessor, ProcessorWrapper } = await import(
        '@livekit/track-processors'
      );
      if (!ProcessorWrapper.isSupported) return false;
      if (room() !== r || !isLiveLocalTrack(camTrack)) return true;

      const processor = BackgroundProcessor(processorOptions);
      await camTrack.setProcessor(processor);
      if (room() !== r || !isLiveLocalTrack(camTrack)) {
        await processor.destroy();
        return true;
      }
      setBlurProcessor(processor);
      return true;
    } catch (e) {
      if (room() !== r) return true;
      console.error('failed to attach background effect processor', e);
      return false;
    }
  }

  async function detachBackgroundEffectFromCameraTrack(r: Room) {
    const prev = blurProcessor();
    if (prev) {
      try {
        const camPub = r.localParticipant.getTrackPublication(
          LK_TRACK_SOURCE.Camera
        );
        if (camPub?.track) {
          await (camPub.track as LocalTrack).stopProcessor();
        }
        await prev.destroy();
      } catch (e) {
        console.error('failed to detach background effect processor', e);
      }
      setBlurProcessor(null);
    }
  }

  function bumpTrackVersion() {
    setStore('trackVersion', (v) => v + 1);
  }

  function resetState() {
    // Preserve joinError across room teardown — LiveKit can emit Disconnected
    // when the network drops or reconnects; wiping joinError would hide the
    // "Try again" UI while the user is still not in the call (empty ChannelCallTab).
    setStore({
      ...initialState,
      joinError: store.joinError,
      backgroundEffect: persistedBackgroundEffect(),
      noiseSuppressionMode: persistedNoiseSuppressionMode(),
    });
  }

  function destroyRoomProcessors() {
    const krisp = krispFilter();
    if (krisp) {
      krisp.destroy().catch((e) => {
        console.error('failed to destroy Krisp noise filter', e);
      });
      setKrispFilter(null);
    }
    const blur = blurProcessor();
    if (blur) {
      // Fire and forget — we're tearing down the room regardless.
      blur.destroy().catch((e) => {
        console.error('failed to destroy background blur processor', e);
      });
      setBlurProcessor(null);
    }
  }

  // --- device enumeration ---

  async function enumerateDevices() {
    // Device lists are only consumed after a browser call has loaded LiveKit.
    // Native calls own device selection outside this JS context.
    const livekitModule = getLivekit();
    if (!livekitModule) return;
    const { Room } = livekitModule;

    try {
      const devices = await Room.getLocalDevices('audioinput');
      setStore(
        'audioInputDevices',
        devices.map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone (${d.deviceId.slice(0, 5)})`,
          kind: d.kind,
        }))
      );
    } catch (e) {
      console.error('failed to enumerate audio input devices', e);
    }

    try {
      const devices = await Room.getLocalDevices('audiooutput');
      setStore(
        'audioOutputDevices',
        devices.map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `Speaker (${d.deviceId.slice(0, 5)})`,
          kind: d.kind,
        }))
      );
    } catch (e) {
      console.error('failed to enumerate audio output devices', e);
    }

    try {
      const devices = await Room.getLocalDevices('videoinput');
      setStore(
        'videoInputDevices',
        devices.map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera (${d.deviceId.slice(0, 5)})`,
          kind: d.kind,
        }))
      );
    } catch (e) {
      console.error('failed to enumerate video input devices', e);
    }
  }

  function trackActiveDevices(r: Room) {
    const micPub = r.localParticipant.getTrackPublication(
      LK_TRACK_SOURCE.Microphone
    );
    if (micPub?.track) {
      const settings = (
        micPub.track as LocalTrack
      ).mediaStreamTrack?.getSettings();
      if (settings?.deviceId) {
        setStore('activeAudioInputDeviceId', settings.deviceId);
      }
    }

    // Audio output has no media track — use the room's active device or fall
    // back to the first enumerated output device so the radio is pre-selected.
    const activeOutput = r.getActiveDevice('audiooutput');
    const outputDevices = store.audioOutputDevices;
    if (
      activeOutput &&
      outputDevices.some((d) => d.deviceId === activeOutput)
    ) {
      setStore('activeAudioOutputDeviceId', activeOutput);
    } else if (outputDevices.length > 0) {
      setStore('activeAudioOutputDeviceId', outputDevices[0].deviceId);
    }

    // Only set the active video device when we can read it from a live track.
    // When video is off we leave it null — guessing would show the wrong
    // selection if the browser's default differs from the first enumerated device.
    const camPub = r.localParticipant.getTrackPublication(
      LK_TRACK_SOURCE.Camera
    );
    if (camPub?.track) {
      const settings = (
        camPub.track as LocalTrack
      ).mediaStreamTrack?.getSettings();
      if (settings?.deviceId) {
        setStore('activeVideoInputDeviceId', settings.deviceId);
      }
    }
  }

  async function switchAudioInput(deviceId: string) {
    const r = room();
    if (!r) return;
    try {
      await r.switchActiveDevice('audioinput', deviceId);
      setStore('activeAudioInputDeviceId', deviceId);

      // If the mic is live, cycle mute/unmute as a nudge for devices where
      // switchActiveDevice's internal track restart doesn't take. Note this
      // is NOT a republish: setMicrophoneEnabled(true, opts) ignores the
      // capture options when the muted publication survives
      // (stopMicTrackOnMute is false), so the device change itself always
      // comes from switchActiveDevice above.
      if (!store.isAudioMuted) {
        await r.localParticipant.setMicrophoneEnabled(false);
        await r.localParticipant.setMicrophoneEnabled(
          true,
          currentMicrophoneCaptureOptions(deviceId)
        );
        // The mic track may have changed — re-apply the selected audio processing.
        await ensureNoiseSuppressionOnMicTrack(r);
      }
    } catch (e) {
      console.error('failed to switch audio input device', e);
    }
  }

  async function switchAudioOutput(deviceId: string) {
    const r = room();
    if (!r) return;
    try {
      await r.switchActiveDevice('audiooutput', deviceId);
      setStore('activeAudioOutputDeviceId', deviceId);
    } catch (e) {
      console.error('failed to switch audio output device', e);
    }
  }

  async function switchVideoInput(deviceId: string) {
    if (currentNativeCallSnapshot()) {
      console.info(
        '[callkit] ignoring JS video input switch; native drawer controls camera'
      );
      return;
    }

    const r = room();
    if (!r) return;
    try {
      await r.switchActiveDevice('videoinput', deviceId);
      setStore('activeVideoInputDeviceId', deviceId);

      // If camera is currently live, republish with the new device.
      if (!store.isVideoMuted) {
        await r.localParticipant.setCameraEnabled(false);
        await r.localParticipant.setCameraEnabled(true, {
          deviceId: { exact: deviceId },
        });
        // New track was created — re-attach the background effect processor if enabled.
        await ensureBackgroundEffectOnCameraTrack(r, true);
      }
    } catch (e) {
      console.error('failed to switch video input device', e);
    }
  }

  // Re-enumerate when devices change (e.g. headphones plugged in)
  const handleDeviceChange = () => {
    enumerateDevices();
  };
  navigator.mediaDevices?.addEventListener('devicechange', handleDeviceChange);

  const currentConnectionState = () => {
    const native = currentNativeCallSnapshot();
    return native
      ? NATIVE_TO_LIVEKIT_STATE[native.connectionState]
      : store.connectionState;
  };

  const currentActiveChannelId = () =>
    currentNativeCallSnapshot()?.channelId ??
    nativeCall?.bootstrapChannelId() ??
    store.activeChannelId ??
    store.optimisticJoinChannelId;

  const currentActiveCallId = () =>
    currentNativeCallSnapshot()?.callId ?? store.activeCallId;

  const currentIsAudioMuted = () =>
    currentNativeCallSnapshot()?.isAudioMuted ?? store.isAudioMuted;

  const currentIsVideoMuted = () =>
    currentNativeCallSnapshot()?.isVideoMuted ?? store.isVideoMuted;

  const currentIsInCall = () =>
    isActiveCallConnectionState(currentConnectionState()) ||
    (currentNativeCallSnapshot() === null &&
      (nativeCall?.bootstrapChannelId() ?? null) !== null) ||
    (currentNativeCallSnapshot() === null &&
      store.optimisticJoinChannelId !== null);

  const currentIsConnecting = () =>
    (currentNativeCallSnapshot() === null &&
      (nativeCall?.bootstrapChannelId() ?? null) !== null) ||
    (currentNativeCallSnapshot() === null &&
      store.optimisticJoinChannelId !== null) ||
    currentConnectionState() === LK_CONNECTION_STATE.Connecting ||
    currentConnectionState() === LK_CONNECTION_STATE.Reconnecting ||
    currentConnectionState() === LK_CONNECTION_STATE.SignalReconnecting;

  const currentJoinError = () =>
    currentNativeCallSnapshot() ? null : store.joinError;

  // --- mutations ---

  async function finishLocalMediaSetup(targetRoom: Room, setupVersion: number) {
    if (!isCurrentMediaSetup(targetRoom, setupVersion)) return;

    // Enable microphone by default.
    try {
      await targetRoom.localParticipant.setMicrophoneEnabled(
        true,
        currentMicrophoneCaptureOptions()
      );
    } catch (e) {
      console.error('failed to enable microphone', e);
    }
    if (!isCurrentMediaSetup(targetRoom, setupVersion)) return;
    if (store.isAudioMuted) {
      // The user muted while the initial enable was in flight; honor their
      // latest intent instead of letting background setup re-open the mic.
      try {
        await targetRoom.localParticipant.setMicrophoneEnabled(false);
      } catch (e) {
        console.error('failed to keep microphone muted', e);
      }
    } else {
      // Attach Krisp when supported; otherwise use one browser-native layer.
      // ensureNoiseSuppressionOnMicTrack is a no-op when the user's pref is off.
      await ensureNoiseSuppressionOnMicTrack(targetRoom);
    }
    if (!isCurrentMediaSetup(targetRoom, setupVersion)) return;

    // Enumerate available devices and track active ones.
    await enumerateDevices();
    if (!isCurrentMediaSetup(targetRoom, setupVersion)) return;
    trackActiveDevices(targetRoom);
  }

  // Create the browser controller on first use. LiveKit gates signaling;
  // Krisp deliberately does not, because its much larger chunk is optional
  // media enhancement and finishLocalMediaSetup already runs in the background.
  let livekitJs: LivekitJsCallController | null = null;
  let livekitJsPromise: Promise<LivekitJsCallController> | null = null;
  let browserConnectGeneration = 0;
  let disposed = false;

  function getLivekitJsController(): Promise<LivekitJsCallController> {
    if (livekitJsPromise) return livekitJsPromise;

    livekitJsPromise = Promise.all([
      import('./LivekitJsCallController'),
      loadLivekit(),
    ])
      .then(([module]) => {
        if (disposed) {
          throw new Error('Call provider disposed while LiveKit was loading');
        }
        livekitJs = module.createLivekitJsCallController(livekitJsOptions);
        return livekitJs;
      })
      .catch((error: unknown) => {
        livekitJsPromise = null;
        throw error;
      });

    return livekitJsPromise;
  }

  const livekitJsOptions: LivekitJsCallControllerOptions = {
    room,
    setRoom,
    state: () => ({
      activeChannelId: store.activeChannelId,
      activeCallId: store.activeCallId,
      connectionState: store.connectionState,
    }),
    currentMicrophoneCaptureOptions,
    isActiveConnectionState: isActiveCallConnectionState,
    cancelPendingMediaSetup,
    nextMediaSetupVersion,
    finishLocalMediaSetup,
    destroyProcessors: destroyRoomProcessors,
    resetState,
    setConnectionState: (state) => setStore('connectionState', state),
    setActiveCall: (channelId, callId) => {
      setStore('activeChannelId', channelId);
      setStore('activeCallId', callId);
    },
    setDuplicateConnectCallId: (callId) => {
      setStore('activeCallId', callId);
      setStore('optimisticJoinChannelId', null);
      setStore('joinError', null);
    },
    setInitialMediaState: () => {
      setStore('isAudioMuted', false);
      setStore('isVideoMuted', true);
    },
    setRemoteParticipants: (participants) => {
      setStore('remoteParticipants', participants);
    },
    setSharedWithTeam: (value) => setStore('isSharedWithTeam', value),
    clearOptimisticJoin: () => {
      setStore('optimisticJoinChannelId', null);
      setStore('joinError', null);
    },
    bumpTrackVersion,
    bumpSpeakerVersion: () => setStore('speakerVersion', (v) => v + 1),
    setScreenSharing: (value) => setStore('isScreenSharing', value),
  };

  const callSession = createCallSessionController({
    nativeCall,
    jsConnect: async (tokenResponse) => {
      const generation = ++browserConnectGeneration;
      const controller = await getLivekitJsController();
      if (disposed || generation !== browserConnectGeneration) return;
      return controller.connect(tokenResponse);
    },
    jsDisconnect: async () => {
      // Cancel a connect that is still waiting on its dynamic import. This is
      // also reached by timeout/error recovery in useCall.
      browserConnectGeneration += 1;
      if (!livekitJsPromise) return;
      const controller = await getLivekitJsController();
      if (disposed) return;
      return controller.disconnect();
    },
    clearOptimisticJoin: () => {
      setStore('optimisticJoinChannelId', null);
      setStore('joinError', null);
    },
  });

  async function toggleAudio() {
    const r = room();
    if (!r) return;
    const newMuted = !store.isAudioMuted;
    try {
      if (newMuted) {
        await r.localParticipant.setMicrophoneEnabled(false);
      } else {
        // Re-enable the mic. When the muted publication survived
        // (stopMicTrackOnMute is false) this only unmutes and the capture
        // options are ignored; they matter when the track was stopped and
        // must be recreated (e.g. after a device unplug).
        const deviceId = store.activeAudioInputDeviceId;
        await r.localParticipant.setMicrophoneEnabled(
          true,
          currentMicrophoneCaptureOptions(deviceId)
        );
        // The mic track may have changed — re-apply the selected audio processing.
        await ensureNoiseSuppressionOnMicTrack(r);
      }
      setStore('isAudioMuted', newMuted);
    } catch (e) {
      console.error('failed to toggle audio', e);
    }
  }

  async function toggleVideo() {
    if (currentNativeCallSnapshot()) {
      console.info(
        '[callkit] ignoring JS video toggle; native drawer controls camera'
      );
      return;
    }

    const r = room();
    if (!r) return;
    const newMuted = !store.isVideoMuted;
    try {
      if (newMuted) {
        await r.localParticipant.setCameraEnabled(false);
        // Track is gone — drop our processor ref so the next enable starts clean.
        setBlurProcessor(null);
      } else {
        const deviceId = store.activeVideoInputDeviceId;
        await r.localParticipant.setCameraEnabled(
          true,
          deviceId ? { deviceId: { exact: deviceId } } : undefined
        );
        // Read the actual device the browser chose so the dropdown is accurate
        const camPub = r.localParticipant.getTrackPublication(
          LK_TRACK_SOURCE.Camera
        );
        if (camPub?.track) {
          const settings = (
            camPub.track as LocalTrack
          ).mediaStreamTrack?.getSettings();
          if (settings?.deviceId) {
            setStore('activeVideoInputDeviceId', settings.deviceId);
          }
        }
        // New camera track was created — attach background effect processor if preference is on.
        await ensureBackgroundEffectOnCameraTrack(r, true);
      }
      setStore('isVideoMuted', newMuted);
    } catch (e) {
      console.error('failed to toggle video', e);
    }
  }

  async function toggleScreenShare() {
    const r = room();
    if (!r) return;
    const newSharing = !store.isScreenSharing;
    try {
      await r.localParticipant.setScreenShareEnabled(newSharing);
      setStore('isScreenSharing', newSharing);
      analytics.track('call_action', {
        action: 'screen_share_toggled',
        channelId: store.activeChannelId ?? '',
        callId: store.activeCallId ?? undefined,
        enabled: newSharing,
      });
    } catch (e) {
      console.error('failed to toggle screen share', e);
    }
  }

  function setSharedWithTeam(value: boolean) {
    setStore('isSharedWithTeam', value);
  }

  async function toggleNoiseSuppression() {
    const newMode: MicNoiseSuppressionMode = isNoiseSuppressionEnabled(
      store.noiseSuppressionMode
    )
      ? 'off'
      : 'krisp';

    setStore('noiseSuppressionMode', newMode);
    setPersistedNoiseSuppressionMode(newMode);

    const r = room();
    if (!r) return;

    try {
      // Both directions run through the serialized ensure path: its 'off'
      // branch detaches Krisp and clears native processing, and queueing
      // means a toggle issued while an attach is in flight still converges
      // on the mode the user picked last.
      await ensureNoiseSuppressionOnMicTrack(r);
    } catch (e) {
      console.error('failed to toggle noise suppression', e);
    }
  }

  // --- optimistic join ---

  function beginOptimisticJoin(channelId: string) {
    // Do not clear joinError here — retries should keep the error panel visible
    // with `isJoining` until LiveKit connects (see useCall join mutation).
    setStore('optimisticJoinChannelId', channelId);
  }

  function rollbackOptimisticJoin() {
    setStore('optimisticJoinChannelId', null);
  }

  function setJoinError(error: string | null) {
    setStore('joinError', error);
  }

  function syncCallPageTab(channelId: string, isCallTab: boolean) {
    if (isCallTab) {
      setStore('callPageChannelId', channelId);
    } else if (store.callPageChannelId === channelId) {
      setStore('callPageChannelId', null);
    }
  }

  async function setBackgroundEffect(effect: BackgroundEffect) {
    const prevEffect = store.backgroundEffect;
    setStore('backgroundEffect', effect);
    setPersistedBackgroundEffect(effect);

    const r = room();
    if (!r) return;

    if (effect.type !== 'none') {
      const attached = await ensureBackgroundEffectOnCameraTrack(r);
      if (!attached) {
        // Processor is unsupported or failed to attach — revert so the UI
        // doesn't show an effect with no processor actually active.
        setStore('backgroundEffect', prevEffect);
        setPersistedBackgroundEffect(prevEffect);
      }
    } else {
      await detachBackgroundEffectFromCameraTrack(r);
    }
  }

  // --- cleanup ---

  const handleBeforeUnload = () => {
    livekitJs?.disconnectBeforeUnload();
  };
  window.addEventListener('beforeunload', handleBeforeUnload);

  onCleanup(() => {
    disposed = true;
    browserConnectGeneration += 1;
    window.removeEventListener('beforeunload', handleBeforeUnload);
    navigator.mediaDevices?.removeEventListener(
      'devicechange',
      handleDeviceChange
    );
    livekitJs?.dispose();
  });

  // --- public API ---

  const state: CallState = {
    // readonly state
    room,
    connectionState: currentConnectionState,
    isInCall: currentIsInCall,
    activeChannelId: currentActiveChannelId,
    activeCallId: currentActiveCallId,
    remoteParticipants: () => store.remoteParticipants,
    trackVersion: () => store.trackVersion,
    isLocalSpeaking: () => {
      // Intentionally read store.speakerVersion to make this reactive so room()?.localParticipant.isSpeaking updates on speakerVersion changes.
      store.speakerVersion;
      return room()?.localParticipant.isSpeaking ?? false;
    },
    isParticipantSpeaking: (participant: RemoteParticipant) => {
      // Intentionally read store.speakerVersion to make this reactive so participant.isSpeaking updates on speakerVersion changes.
      store.speakerVersion;
      return participant.isSpeaking;
    },
    isAudioMuted: currentIsAudioMuted,
    isVideoMuted: currentIsVideoMuted,
    isScreenSharing: () => store.isScreenSharing,
    audioInputDevices: () => store.audioInputDevices,
    audioOutputDevices: () => store.audioOutputDevices,
    videoInputDevices: () => store.videoInputDevices,
    activeAudioInputDeviceId: () => store.activeAudioInputDeviceId,
    activeAudioOutputDeviceId: () => store.activeAudioOutputDeviceId,
    activeVideoInputDeviceId: () => store.activeVideoInputDeviceId,
    isConnecting: currentIsConnecting,

    // mutations
    shouldRequestSessionToken: callSession.shouldRequestToken,
    connectSession: callSession.connectWithToken,
    disconnectSession: callSession.disconnect,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
    switchAudioInput,
    switchAudioOutput,
    switchVideoInput,
    noiseSuppressionMode: () => store.noiseSuppressionMode,
    isNoiseSuppressed: () =>
      isNoiseSuppressionEnabled(store.noiseSuppressionMode),
    toggleNoiseSuppression,
    beginOptimisticJoin,
    rollbackOptimisticJoin,
    joinError: currentJoinError,
    setJoinError,
    callPageChannelId: () => store.callPageChannelId,
    syncCallPageTab,
    isCallPage: () => {
      store.callPageChannelId;
      currentActiveChannelId();
      const page = store.callPageChannelId;
      const active = currentActiveChannelId();
      return page !== null && active !== null && page === active;
    },
    backgroundEffect: () => store.backgroundEffect,
    setBackgroundEffect,
    isSharedWithTeam: () => store.isSharedWithTeam,
    setSharedWithTeam,
  };

  return state;
}

export function CallProvider(props: ParentProps) {
  const state = createCallState();

  return (
    <CallContext.Provider value={state}>
      {props.children}
      <CallAudioSink />
    </CallContext.Provider>
  );
}

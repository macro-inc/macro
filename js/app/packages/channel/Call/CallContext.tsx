import {
  Room,
  RoomEvent,
  ConnectionState,
  Track,
  type RemoteParticipant,
  type LocalTrackPublication,
  type LocalTrack,
  type AudioCaptureOptions,
} from 'livekit-client';
import {
  KrispNoiseFilter,
  isKrispNoiseFilterSupported,
} from '@livekit/krisp-noise-filter';
import type { BackgroundProcessorWrapper } from '@livekit/track-processors';
import {
  createContext,
  createSignal,
  useContext,
  onCleanup,
  type ParentProps,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { makePersisted } from '@solid-primitives/storage';
import type { CallTokenResponse } from '@service-call/client';

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

type NativeAudioProcessingConstraints = MediaTrackConstraints & {
  voiceIsolation?: ConstrainBoolean;
};

function microphoneCaptureOptions(
  noiseSuppressionEnabled: boolean,
  deviceId?: string | null
): AudioCaptureOptions {
  return {
    autoGainControl: true,
    echoCancellation: true,
    noiseSuppression: noiseSuppressionEnabled,
    voiceIsolation: noiseSuppressionEnabled,
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  };
}

function nativeNoiseSuppressionConstraints(
  enabled: boolean
): NativeAudioProcessingConstraints {
  return {
    noiseSuppression: enabled,
    voiceIsolation: enabled,
  };
}

function getLocalMicTrack(r: Room): LocalTrack | undefined {
  return r.localParticipant.getTrackPublication(Track.Source.Microphone)
    ?.track as LocalTrack | undefined;
}

async function applyNativeNoiseSuppressionToMicTrack(
  r: Room,
  enabled: boolean
) {
  const mediaStreamTrack = getLocalMicTrack(r)?.mediaStreamTrack;
  if (!mediaStreamTrack || mediaStreamTrack.readyState === 'ended') return;

  try {
    await mediaStreamTrack.applyConstraints(
      nativeNoiseSuppressionConstraints(enabled)
    );
  } catch (e) {
    console.error('failed to update native mic noise suppression', e);
  }
}

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
  isNoiseSuppressed: boolean;
  backgroundEffect: BackgroundEffect;
  // Mirrors the call's `share_with_team` flag. Defaults to true to match the
  // server-side default for newly-created calls; synced from the toggle
  // endpoint's response on each flip.
  isSharedWithTeam: boolean;
};

const initialState: CallStoreState = {
  connectionState: ConnectionState.Disconnected,
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
  isNoiseSuppressed: false,
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
// filters that attenuate voice. Defaults to on to match existing behavior.
const [persistedNoiseSuppressionPref, setPersistedNoiseSuppressionPref] =
  makePersisted(createSignal<boolean>(true), {
    name: 'call.noiseSuppression',
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
  /** Connect to a call using a token response */
  connect: (tokenResponse: CallTokenResponse) => Promise<void>;
  /** Disconnect from the current call */
  disconnect: () => Promise<void>;
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
  /** Whether mic noise suppression (Krisp or native fallback) is enabled */
  isNoiseSuppressed: () => boolean;
  /** Toggle mic noise suppression on/off */
  toggleNoiseSuppression: () => Promise<void>;
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
  const [room, setRoom] = createSignal<Room | null>(null);
  const [store, setStore] = createStore<CallStoreState>({
    ...initialState,
    backgroundEffect: persistedBackgroundEffect(),
    isNoiseSuppressed: persistedNoiseSuppressionPref(),
  });
  const [krispFilter, setKrispFilter] = createSignal<ReturnType<
    typeof KrispNoiseFilter
  > | null>(null);
  const [blurProcessor, setBlurProcessor] =
    createSignal<BackgroundProcessorWrapper | null>(null);

  // --- internal helpers ---

  /** (Re-)attach the Krisp processor to the current mic track. */
  async function ensureKrispOnMicTrack(r: Room) {
    if (!store.isNoiseSuppressed) return;

    const micTrack = getLocalMicTrack(r);
    if (!micTrack) return;

    const existing = krispFilter();
    if (existing && micTrack.getProcessor() === existing) {
      await existing.setEnabled(true);
      return;
    }

    // Keep native browser NS / voice isolation enabled as a fallback until
    // Krisp is successfully attached. Krisp disables those native constraints
    // in its own init path to avoid stacked software filters.
    await applyNativeNoiseSuppressionToMicTrack(r, true);

    if (!isKrispNoiseFilterSupported()) return;

    try {
      await detachKrispFromMicTrack(r);

      // `quality` is model size/CPU cost, not suppression strength. The default
      // medium model avoids the CPU pressure/dropouts that made voices sound
      // muddy on busy machines while still enabling Krisp when supported.
      const krisp = KrispNoiseFilter({ quality: 'medium' });
      await micTrack.setProcessor(krisp);
      await krisp.setEnabled(true);
      setKrispFilter(krisp);
    } catch (e) {
      console.error('failed to re-attach Krisp noise filter', e);
      // If Krisp failed after changing track constraints, leave browser NS on.
      await applyNativeNoiseSuppressionToMicTrack(r, true);
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

    const camPub = r.localParticipant.getTrackPublication(Track.Source.Camera);
    if (!camPub?.track) return true;

    const processorOptions =
      effect.type === 'blur'
        ? {
            mode: 'background-blur' as const,
            blurRadius: BLUR_RADIUS[effect.intensity],
          }
        : { mode: 'virtual-background' as const, imagePath: effect.path };

    try {
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
        setBlurProcessor(null);
      }

      // Create and attach a new processor.
      const { BackgroundProcessor, ProcessorWrapper } = await import(
        '@livekit/track-processors'
      );
      if (!ProcessorWrapper.isSupported) return false;

      const processor = BackgroundProcessor(processorOptions);
      await (camPub.track as LocalTrack).setProcessor(processor);
      setBlurProcessor(processor);
      return true;
    } catch (e) {
      console.error('failed to attach background effect processor', e);
      return false;
    }
  }

  async function detachBackgroundEffectFromCameraTrack(r: Room) {
    const prev = blurProcessor();
    if (prev) {
      try {
        const camPub = r.localParticipant.getTrackPublication(
          Track.Source.Camera
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

  function syncParticipantMap(r: Room) {
    setStore('remoteParticipants', new Map(r.remoteParticipants));
    bumpTrackVersion();
  }

  function resetState() {
    setStore({
      ...initialState,
      backgroundEffect: persistedBackgroundEffect(),
      isNoiseSuppressed: persistedNoiseSuppressionPref(),
    });
  }

  function attachRoomListeners(r: Room) {
    r.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      setStore('connectionState', state);
    });

    r.on(RoomEvent.ParticipantConnected, () => syncParticipantMap(r));
    r.on(RoomEvent.ParticipantDisconnected, () => syncParticipantMap(r));

    r.on(RoomEvent.TrackSubscribed, bumpTrackVersion);
    r.on(RoomEvent.TrackUnsubscribed, bumpTrackVersion);
    r.on(RoomEvent.TrackMuted, bumpTrackVersion);
    r.on(RoomEvent.TrackUnmuted, bumpTrackVersion);

    r.on(RoomEvent.ActiveSpeakersChanged, () => {
      setStore('speakerVersion', (v) => v + 1);
    });

    r.on(RoomEvent.LocalTrackUnpublished, (pub: LocalTrackPublication) => {
      if (pub.source === Track.Source.ScreenShare) {
        setStore('isScreenSharing', false);
      }
      bumpTrackVersion();
    });
    r.on(RoomEvent.Disconnected, resetState);
  }

  function destroyRoom() {
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
    const r = room();
    if (r) {
      r.removeAllListeners();
      setRoom(null);
    }
    resetState();
  }

  // --- device enumeration ---

  async function enumerateDevices() {
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
      Track.Source.Microphone
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
    const camPub = r.localParticipant.getTrackPublication(Track.Source.Camera);
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

      // If mic is currently live, republish with the new device to ensure it
      // actually takes effect (switchActiveDevice alone can be unreliable).
      if (!store.isAudioMuted) {
        await r.localParticipant.setMicrophoneEnabled(false);
        await r.localParticipant.setMicrophoneEnabled(
          true,
          microphoneCaptureOptions(store.isNoiseSuppressed, deviceId)
        );
        // The mic track may have changed — re-attach the Krisp processor.
        await ensureKrispOnMicTrack(r);
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

  // --- mutations ---

  async function connect(tokenResponse: CallTokenResponse) {
    const existingRoom = room();

    // If switching to a different channel, tear down the old room entirely
    if (existingRoom && store.activeChannelId !== tokenResponse.channelId) {
      await existingRoom.disconnect();
      destroyRoom();
    }

    let targetRoom: Room;
    if (room()) {
      // Reuse existing room instance (same channel, e.g. leave then rejoin)
      targetRoom = room()!;
    } else {
      targetRoom = new Room({
        audioCaptureDefaults: microphoneCaptureOptions(store.isNoiseSuppressed),
      });
      attachRoomListeners(targetRoom);
      setRoom(targetRoom);
    }

    setStore('activeChannelId', tokenResponse.channelId);
    setStore('activeCallId', tokenResponse.callId);
    setStore('isSharedWithTeam', true);

    try {
      await targetRoom.connect(tokenResponse.serverUrl, tokenResponse.token);
    } catch (e) {
      console.error('failed to connect to LiveKit room', e);
      destroyRoom();
      throw e;
    }

    // Sync participants that were already in the room when we connected
    setStore('remoteParticipants', new Map(targetRoom.remoteParticipants));
    bumpTrackVersion();

    // Enable microphone by default, video off by default
    try {
      await targetRoom.localParticipant.setMicrophoneEnabled(
        true,
        microphoneCaptureOptions(store.isNoiseSuppressed)
      );
    } catch (e) {
      console.error('failed to enable microphone', e);
    }
    setStore('isAudioMuted', false);
    setStore('isVideoMuted', true);

    // Attach Krisp when supported; otherwise keep native browser NS enabled.
    // ensureKrispOnMicTrack is a no-op when the user's NS pref is off.
    await ensureKrispOnMicTrack(targetRoom);

    // Enumerate available devices and track active ones
    await enumerateDevices();
    trackActiveDevices(targetRoom);
  }

  async function disconnect() {
    const r = room();
    if (r) {
      try {
        await r.disconnect();
      } finally {
        destroyRoom();
      }
    }
  }

  async function toggleAudio() {
    const r = room();
    if (!r) return;
    const newMuted = !store.isAudioMuted;
    try {
      if (newMuted) {
        await r.localParticipant.setMicrophoneEnabled(false);
      } else {
        // Re-enable with the user's selected device
        const deviceId = store.activeAudioInputDeviceId;
        await r.localParticipant.setMicrophoneEnabled(
          true,
          microphoneCaptureOptions(store.isNoiseSuppressed, deviceId)
        );
        // The mic track may have changed — re-attach the Krisp processor.
        await ensureKrispOnMicTrack(r);
      }
      setStore('isAudioMuted', newMuted);
    } catch (e) {
      console.error('failed to toggle audio', e);
    }
  }

  async function toggleVideo() {
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
          Track.Source.Camera
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
    } catch (e) {
      console.error('failed to toggle screen share', e);
    }
  }

  function setSharedWithTeam(value: boolean) {
    setStore('isSharedWithTeam', value);
  }

  async function toggleNoiseSuppression() {
    const newEnabled = !store.isNoiseSuppressed;
    setStore('isNoiseSuppressed', newEnabled);
    setPersistedNoiseSuppressionPref(newEnabled);

    const r = room();
    if (!r) return;

    try {
      if (newEnabled) {
        await ensureKrispOnMicTrack(r);
      } else {
        await detachKrispFromMicTrack(r);
        await applyNativeNoiseSuppressionToMicTrack(r, false);
      }
    } catch (e) {
      console.error('failed to toggle noise suppression', e);
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
    const r = room();
    if (r) {
      r.disconnect();
    }
  };
  window.addEventListener('beforeunload', handleBeforeUnload);

  onCleanup(() => {
    window.removeEventListener('beforeunload', handleBeforeUnload);
    navigator.mediaDevices?.removeEventListener(
      'devicechange',
      handleDeviceChange
    );
    const r = room();
    if (r) {
      r.disconnect();
      r.removeAllListeners();
    }
  });

  // --- public API ---

  const state: CallState = {
    // readonly state
    room,
    connectionState: () => store.connectionState,
    isInCall: () => store.connectionState === ConnectionState.Connected,
    activeChannelId: () => store.activeChannelId,
    activeCallId: () => store.activeCallId,
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
    isAudioMuted: () => store.isAudioMuted,
    isVideoMuted: () => store.isVideoMuted,
    isScreenSharing: () => store.isScreenSharing,
    audioInputDevices: () => store.audioInputDevices,
    audioOutputDevices: () => store.audioOutputDevices,
    videoInputDevices: () => store.videoInputDevices,
    activeAudioInputDeviceId: () => store.activeAudioInputDeviceId,
    activeAudioOutputDeviceId: () => store.activeAudioOutputDeviceId,
    activeVideoInputDeviceId: () => store.activeVideoInputDeviceId,

    // mutations
    connect,
    disconnect,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
    switchAudioInput,
    switchAudioOutput,
    switchVideoInput,
    isNoiseSuppressed: () => store.isNoiseSuppressed,
    toggleNoiseSuppression,
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
    <CallContext.Provider value={state}>{props.children}</CallContext.Provider>
  );
}

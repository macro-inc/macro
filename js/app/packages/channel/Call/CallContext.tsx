import {
  Room,
  RoomEvent,
  ConnectionState,
  Track,
  type RemoteParticipant,
  type LocalTrackPublication,
  type LocalTrack,
} from 'livekit-client';
import {
  KrispNoiseFilter,
  isKrispNoiseFilterSupported,
} from '@livekit/krisp-noise-filter';
import {
  createContext,
  createSignal,
  useContext,
  onCleanup,
  type ParentProps,
} from 'solid-js';
import { createStore } from 'solid-js/store';
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

type CallStoreState = {
  connectionState: ConnectionState;
  activeChannelId: string | null;
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
};

const initialState: CallStoreState = {
  connectionState: ConnectionState.Disconnected,
  activeChannelId: null,
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
};

export type CallState = {
  /** The LiveKit Room instance, null when not in a call */
  room: () => Room | null;
  /** Current connection state */
  connectionState: () => ConnectionState;
  /** Whether the local user is currently in a call */
  isInCall: () => boolean;
  /** Channel ID of the active call */
  activeChannelId: () => string | null;
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
  /** Whether Krisp noise suppression is active */
  isNoiseSuppressed: () => boolean;
  /** Toggle Krisp noise suppression on/off */
  toggleNoiseSuppression: () => Promise<void>;
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
  const [store, setStore] = createStore<CallStoreState>({ ...initialState });
  const [krispFilter, setKrispFilter] = createSignal<ReturnType<
    typeof KrispNoiseFilter
  > | null>(null);

  // --- internal helpers ---

  function bumpTrackVersion() {
    setStore('trackVersion', (v) => v + 1);
  }

  function syncParticipantMap(r: Room) {
    setStore('remoteParticipants', new Map(r.remoteParticipants));
    bumpTrackVersion();
  }

  function resetState() {
    setStore({ ...initialState });
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
      krisp.destroy();
      setKrispFilter(null);
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
        await r.localParticipant.setMicrophoneEnabled(true, {
          deviceId: { exact: deviceId },
        });
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
        audioCaptureDefaults: {
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true,
        },
      });
      attachRoomListeners(targetRoom);
      setRoom(targetRoom);
    }

    setStore('activeChannelId', tokenResponse.channelId);

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
      await targetRoom.localParticipant.setMicrophoneEnabled(true);
    } catch (e) {
      console.error('failed to enable microphone', e);
    }
    setStore('isAudioMuted', false);
    setStore('isVideoMuted', true);

    // Register Krisp noise filter on the mic track
    if (isKrispNoiseFilterSupported()) {
      try {
        const micPub = targetRoom.localParticipant.getTrackPublication(
          Track.Source.Microphone
        );
        if (micPub?.track) {
          const krisp = KrispNoiseFilter();
          await (micPub.track as LocalTrack).setProcessor(krisp);
          setKrispFilter(krisp);
          setStore('isNoiseSuppressed', true);
        }
      } catch (e) {
        console.error('failed to enable Krisp noise filter', e);
      }
    }

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
          deviceId ? { deviceId: { exact: deviceId } } : undefined
        );
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

  async function toggleNoiseSuppression() {
    const krisp = krispFilter();
    if (!krisp) return;
    try {
      const newEnabled = !store.isNoiseSuppressed;
      await krisp.setEnabled(newEnabled);
      setStore('isNoiseSuppressed', newEnabled);
    } catch (e) {
      console.error('failed to toggle noise suppression', e);
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
  };

  return state;
}

export function CallProvider(props: ParentProps) {
  const state = createCallState();

  return (
    <CallContext.Provider value={state}>{props.children}</CallContext.Provider>
  );
}

import {
  Room,
  RoomEvent,
  ConnectionState,
  Track,
  type RemoteParticipant,
  type LocalTrackPublication,
} from 'livekit-client';
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

type CallStoreState = {
  connectionState: ConnectionState;
  activeChannelId: string | null;
  remoteParticipants: Map<string, RemoteParticipant>;
  isAudioMuted: boolean;
  isVideoMuted: boolean;
  isScreenSharing: boolean;
  trackVersion: number;
  speakerVersion: number;
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
    const r = room();
    if (r) {
      r.removeAllListeners();
      setRoom(null);
    }
    resetState();
  }

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
      targetRoom = new Room();
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
      await r.localParticipant.setMicrophoneEnabled(!newMuted);
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
      await r.localParticipant.setCameraEnabled(!newMuted);
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

    // mutations
    connect,
    disconnect,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
  };

  return state;
}

export function CallProvider(props: ParentProps) {
  const state = createCallState();

  return (
    <CallContext.Provider value={state}>{props.children}</CallContext.Provider>
  );
}

import {
  Room,
  RoomEvent,
  ConnectionState,
  Track,
  type RemoteParticipant,
  type RemoteTrackPublication,
  type RemoteTrack,
  type LocalTrackPublication,
  type Participant,
  type TranscriptionSegment,
} from 'livekit-client';
import {
  createContext,
  createSignal,
  useContext,
  onCleanup,
  type ParentProps,
} from 'solid-js';
import type { CallTokenResponse } from '@service-call/client';

export type CallParticipantInfo = {
  identity: string;
  isSpeaking: boolean;
  isMuted: boolean;
  hasVideo: boolean;
};

export type FinalTranscriptSegment = {
  id: string;
  text: string;
  participantIdentity: string;
  isFinal: boolean;
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
  /** Incremented on every track/participant event to drive reactivity in UI components */
  trackVersion: () => number;
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
  /** Transcript segments received via lk.transcription stream */
  transcriptSegments: () => TranscriptionSegment[];
  /** Register a callback for when final transcript segments are received */
  onTranscriptSegment: (cb: (segment: FinalTranscriptSegment) => void) => void;
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

export function CallProvider(props: ParentProps) {
  const [room, setRoom] = createSignal<Room | null>(null);
  const [connectionState, setConnectionState] = createSignal<ConnectionState>(
    ConnectionState.Disconnected
  );
  const [activeChannelId, setActiveChannelId] = createSignal<string | null>(
    null
  );
  const [remoteParticipants, setRemoteParticipants] = createSignal<
    Map<string, RemoteParticipant>
  >(new Map());
  const [isAudioMuted, setIsAudioMuted] = createSignal(false);
  const [isVideoMuted, setIsVideoMuted] = createSignal(true);
  const [isScreenSharing, setIsScreenSharing] = createSignal(false);
  const [trackVersion, setTrackVersion] = createSignal(0);
  const [transcriptSegments, setTranscriptSegments] = createSignal<
    TranscriptionSegment[]
  >([]);
  let transcriptCallback: ((segment: FinalTranscriptSegment) => void) | null =
    null;

  function syncParticipants(r: Room) {
    setRemoteParticipants(new Map(r.remoteParticipants));
    setTrackVersion((v) => v + 1);
  }

  function attachRoomListeners(r: Room) {
    r.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      setConnectionState(state);
    });
    r.on(RoomEvent.ParticipantConnected, () => syncParticipants(r));
    r.on(RoomEvent.ParticipantDisconnected, () => syncParticipants(r));
    r.on(
      RoomEvent.TrackSubscribed,
      (
        _track: RemoteTrack,
        _pub: RemoteTrackPublication,
        _participant: RemoteParticipant
      ) => {
        syncParticipants(r);
      }
    );
    r.on(RoomEvent.TrackUnsubscribed, () => syncParticipants(r));
    r.on(RoomEvent.TrackMuted, () => syncParticipants(r));
    r.on(RoomEvent.TrackUnmuted, () => syncParticipants(r));
    r.on(RoomEvent.ActiveSpeakersChanged, (_speakers: Participant[]) => {
      syncParticipants(r);
    });
    r.on(
      RoomEvent.LocalTrackUnpublished,
      (pub: LocalTrackPublication) => {
        if (pub.source === Track.Source.ScreenShare) {
          setIsScreenSharing(false);
        }
        syncParticipants(r);
      }
    );
    r.on(RoomEvent.Disconnected, () => {
      cleanupRoom();
    });

    // Register lk.transcription text stream handler
    r.registerTextStreamHandler(
      'lk.transcription',
      async (_reader, participantInfo) => {
        const reader = _reader;
        const text = await reader.readAll();
        const isFinal =
          reader.info.attributes?.['lk.transcription_final'] === 'true';
        const segment: TranscriptionSegment = {
          id: reader.info.id,
          text,
          language: reader.info.attributes?.['lk.language'] ?? '',
          startTime: 0,
          endTime: 0,
          final: isFinal,
          firstReceivedTime: Date.now(),
          lastReceivedTime: Date.now(),
        };
        if (isFinal) {
          setTranscriptSegments((prev) => [...prev, segment]);
          transcriptCallback?.({
            id: reader.info.id,
            text,
            participantIdentity: participantInfo?.identity ?? '',
            isFinal: true,
          });
        }
      }
    );
  }

  function cleanupRoom() {
    const r = room();
    if (r) {
      r.removeAllListeners();
      setRoom(null);
    }
    setConnectionState(ConnectionState.Disconnected);
    setActiveChannelId(null);
    setRemoteParticipants(new Map());
    setIsAudioMuted(false);
    setIsVideoMuted(true);
    setIsScreenSharing(false);
    setTranscriptSegments([]);
  }

  async function connect(tokenResponse: CallTokenResponse) {
    // Disconnect from any existing call first
    await disconnect();

    const newRoom = new Room();
    attachRoomListeners(newRoom);
    setRoom(newRoom);
    setActiveChannelId(tokenResponse.channelId);

    try {
      await newRoom.connect(tokenResponse.serverUrl, tokenResponse.token);
    } catch (e) {
      console.error('failed to connect to LiveKit room', e);
      cleanupRoom();
      throw e;
    }

    // Enable microphone by default, video off by default
    try {
      await newRoom.localParticipant.setMicrophoneEnabled(true);
    } catch (e) {
      console.error('failed to enable microphone', e);
    }
    setIsAudioMuted(false);
    setIsVideoMuted(true);
  }

  async function disconnect() {
    const r = room();
    if (r) {
      await r.disconnect();
      cleanupRoom();
    }
  }

  async function toggleAudio() {
    const r = room();
    if (!r) return;
    const newMuted = !isAudioMuted();
    await r.localParticipant.setMicrophoneEnabled(!newMuted);
    setIsAudioMuted(newMuted);
  }

  async function toggleVideo() {
    const r = room();
    if (!r) return;
    const newMuted = !isVideoMuted();
    await r.localParticipant.setCameraEnabled(!newMuted);
    setIsVideoMuted(newMuted);
  }

  async function toggleScreenShare() {
    const r = room();
    if (!r) return;
    const newSharing = !isScreenSharing();
    await r.localParticipant.setScreenShareEnabled(newSharing);
    setIsScreenSharing(newSharing);
  }

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

  const state: CallState = {
    room,
    connectionState,
    isInCall: () => connectionState() === ConnectionState.Connected,
    activeChannelId,
    remoteParticipants,
    trackVersion,
    isAudioMuted,
    isVideoMuted,
    isScreenSharing,
    connect,
    disconnect,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
    transcriptSegments,
    onTranscriptSegment: (cb) => {
      transcriptCallback = cb;
    },
  };

  return (
    <CallContext.Provider value={state}>{props.children}</CallContext.Provider>
  );
}

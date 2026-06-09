import type { CallTokenResponse } from '@service-call/client';
import {
  type AudioCaptureOptions,
  type ConnectionState,
  type LocalTrackPublication,
  type RemoteParticipant,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client';

type LivekitJsCallControllerState = {
  activeChannelId: string | null;
  activeCallId: string | null;
  connectionState: ConnectionState;
};

type LivekitJsCallControllerOptions = {
  room: () => Room | null;
  setRoom: (room: Room | null) => void;
  state: () => LivekitJsCallControllerState;
  currentMicrophoneCaptureOptions: () => AudioCaptureOptions;
  isActiveConnectionState: (state: ConnectionState) => boolean;
  cancelPendingMediaSetup: () => void;
  nextMediaSetupVersion: () => number;
  finishLocalMediaSetup: (room: Room, setupVersion: number) => Promise<void>;
  destroyProcessors: () => void;
  resetState: () => void;
  setConnectionState: (state: ConnectionState) => void;
  setActiveCall: (channelId: string, callId: string) => void;
  setDuplicateConnectCallId: (callId: string) => void;
  setInitialMediaState: () => void;
  setRemoteParticipants: (participants: Map<string, RemoteParticipant>) => void;
  setSharedWithTeam: (value: boolean) => void;
  clearOptimisticJoin: () => void;
  bumpTrackVersion: () => void;
  bumpSpeakerVersion: () => void;
  setScreenSharing: (value: boolean) => void;
};

export function createLivekitJsCallController(
  options: LivekitJsCallControllerOptions
) {
  function syncParticipantMap(room: Room) {
    options.setRemoteParticipants(new Map(room.remoteParticipants));
    options.bumpTrackVersion();
  }

  function attachRoomListeners(room: Room) {
    room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      const snapshot = options.state();
      console.debug('[call] connection state changed', {
        state,
        room: snapshot.activeChannelId,
        call: snapshot.activeCallId,
      });
      options.setConnectionState(state);
    });

    room.on(RoomEvent.ParticipantConnected, () => syncParticipantMap(room));
    room.on(RoomEvent.ParticipantDisconnected, () => syncParticipantMap(room));

    room.on(RoomEvent.TrackSubscribed, options.bumpTrackVersion);
    room.on(RoomEvent.TrackUnsubscribed, options.bumpTrackVersion);
    room.on(RoomEvent.TrackPublished, options.bumpTrackVersion);
    room.on(RoomEvent.TrackUnpublished, options.bumpTrackVersion);
    room.on(RoomEvent.TrackMuted, options.bumpTrackVersion);
    room.on(RoomEvent.TrackUnmuted, options.bumpTrackVersion);
    room.on(RoomEvent.LocalTrackPublished, options.bumpTrackVersion);

    room.on(RoomEvent.ActiveSpeakersChanged, options.bumpSpeakerVersion);

    room.on(RoomEvent.LocalTrackUnpublished, (pub: LocalTrackPublication) => {
      if (pub.source === Track.Source.ScreenShare) {
        options.setScreenSharing(false);
      }
      options.bumpTrackVersion();
    });

    room.on(RoomEvent.Disconnected, (reason?: unknown) => {
      const snapshot = options.state();
      console.warn('[call] room disconnected', {
        reason,
        room: snapshot.activeChannelId,
        call: snapshot.activeCallId,
      });
      options.resetState();
    });
  }

  function destroyRoom() {
    options.cancelPendingMediaSetup();
    options.destroyProcessors();

    const room = options.room();
    if (room) {
      room.removeAllListeners();
      options.setRoom(null);
    }

    options.resetState();
  }

  async function connect(tokenResponse: CallTokenResponse) {
    const existingRoom = options.room();
    const state = options.state();

    if (
      existingRoom &&
      state.activeChannelId === tokenResponse.channelId &&
      options.isActiveConnectionState(state.connectionState)
    ) {
      // A duplicate join can arrive while LiveKit is already connected or
      // recovering its signaling connection. Do not call room.connect() again;
      // that replaces the SDK's reconnection attempt and can wedge the peer
      // connection until the user manually leaves/rejoins.
      console.debug('[call] ignoring duplicate connect for active room', {
        channelId: tokenResponse.channelId,
        state: state.connectionState,
      });
      options.setDuplicateConnectCallId(tokenResponse.callId);
      return;
    }

    // If switching channels, or if a previous disconnected room instance is
    // still hanging around after a failed reconnect, tear it down and build a
    // fresh Room. This gives retry/auto-rejoin the same clean slate as a manual
    // leave + join.
    if (existingRoom) {
      await existingRoom.disconnect();
      destroyRoom();
    }

    const targetRoom = new Room({
      audioCaptureDefaults: options.currentMicrophoneCaptureOptions(),
    });
    attachRoomListeners(targetRoom);
    options.setRoom(targetRoom);
    options.setActiveCall(tokenResponse.channelId, tokenResponse.callId);
    options.setSharedWithTeam(true);

    try {
      await targetRoom.connect(tokenResponse.serverUrl, tokenResponse.token);
      options.clearOptimisticJoin();
    } catch (e) {
      console.error('failed to connect to LiveKit room', e);
      destroyRoom();
      throw e;
    }

    // Sync participants that were already in the room when we connected.
    syncParticipantMap(targetRoom);

    // Default to microphone on, video off as soon as the room is connected.
    options.setInitialMediaState();

    // Treat the LiveKit connection itself as the join success boundary. Local
    // media/device setup can be interrupted by OS-level flows (e.g. macOS
    // screenshot) or slow permission/device APIs; if we await it here, the
    // join mutation timeout can fire after the user is already in the room and
    // run failed-join cleanup, which calls DELETE /call/:channel and kicks the
    // user out. Run the non-critical setup in the background instead.
    const setupVersion = options.nextMediaSetupVersion();
    void options.finishLocalMediaSetup(targetRoom, setupVersion).catch((e) => {
      console.error('failed to finish local call media setup', e);
    });
  }

  async function disconnect() {
    const room = options.room();
    if (!room) return;

    options.cancelPendingMediaSetup();
    try {
      await room.disconnect();
    } finally {
      destroyRoom();
    }
  }

  function disconnectBeforeUnload() {
    const room = options.room();
    if (!room) return;

    options.cancelPendingMediaSetup();
    room.disconnect();
  }

  function dispose() {
    options.cancelPendingMediaSetup();
    const room = options.room();
    if (!room) return;

    room.disconnect();
    room.removeAllListeners();
  }

  return {
    connect,
    disconnect,
    disconnectBeforeUnload,
    dispose,
  };
}

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
import { batch } from 'solid-js';
import type { CallSessionConnectMetadata } from './CallSessionController';
import { startReceiverStatsSampling } from './call-audio-receiver-stats';

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
  setActiveCall: (channelId: string | null, callId: string) => void;
  setDuplicateConnectCallId: (callId: string) => void;
  setInitialMediaState: (preferences?: CallSessionConnectMetadata) => void;
  setRemoteParticipants: (participants: Map<string, RemoteParticipant>) => void;
  clearOptimisticJoin: () => void;
  bumpTrackVersion: () => void;
  bumpSpeakerVersion: () => void;
  setScreenSharing: (value: boolean) => void;
};

export function createLivekitJsCallController(
  options: LivekitJsCallControllerOptions
) {
  let stopReceiverStatsSampling: (() => void) | null = null;
  let disposed = false;
  let connectGeneration = 0;

  function isCurrentRoom(room: Room) {
    return !disposed && options.room() === room;
  }

  function stopReceiverStats() {
    stopReceiverStatsSampling?.();
    stopReceiverStatsSampling = null;
  }

  function syncParticipantMap(room: Room) {
    if (!isCurrentRoom(room)) return;
    options.setRemoteParticipants(new Map(room.remoteParticipants));
    options.bumpTrackVersion();
  }

  function attachRoomListeners(
    room: Room,
    call: Pick<CallTokenResponse, 'channelId' | 'callId'>
  ) {
    const bumpTrackVersion = () => {
      if (isCurrentRoom(room)) options.bumpTrackVersion();
    };

    room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      if (!isCurrentRoom(room)) return;
      console.debug('[call] connection state changed', {
        state,
        room: call.channelId,
        call: call.callId,
      });
      // A terminal disconnect clears the UI state, but the current Room can
      // still report a late recovery. Restore its identity with the connection
      // state so audio and channel UI agree about which call is connected.
      batch(() => {
        if (options.isActiveConnectionState(state)) {
          options.setActiveCall(call.channelId, call.callId);
        }
        options.setConnectionState(state);
      });
    });

    room.on(RoomEvent.ParticipantConnected, () => syncParticipantMap(room));
    room.on(RoomEvent.ParticipantDisconnected, () => syncParticipantMap(room));

    room.on(RoomEvent.TrackSubscribed, bumpTrackVersion);
    room.on(RoomEvent.TrackUnsubscribed, bumpTrackVersion);
    room.on(RoomEvent.TrackPublished, bumpTrackVersion);
    room.on(RoomEvent.TrackUnpublished, bumpTrackVersion);
    room.on(RoomEvent.TrackMuted, bumpTrackVersion);
    room.on(RoomEvent.TrackUnmuted, bumpTrackVersion);
    room.on(RoomEvent.LocalTrackPublished, bumpTrackVersion);

    room.on(RoomEvent.ActiveSpeakersChanged, () => {
      if (isCurrentRoom(room)) options.bumpSpeakerVersion();
    });

    room.on(RoomEvent.LocalTrackUnpublished, (pub: LocalTrackPublication) => {
      if (!isCurrentRoom(room)) return;
      if (pub.source === Track.Source.ScreenShare) {
        options.setScreenSharing(false);
      }
      options.bumpTrackVersion();
    });

    room.on(RoomEvent.Disconnected, (reason?: unknown) => {
      if (!isCurrentRoom(room)) return;
      console.warn('[call] room disconnected', {
        reason,
        room: call.channelId,
        call: call.callId,
      });
      options.resetState();
    });
  }

  function destroyRoom(room: Room) {
    room.removeAllListeners();
    if (!isCurrentRoom(room)) return;

    options.cancelPendingMediaSetup();
    stopReceiverStats();
    options.destroyProcessors();

    options.setRoom(null);
    options.resetState();
  }

  async function connect(
    tokenResponse: CallTokenResponse,
    preferences?: CallSessionConnectMetadata
  ) {
    if (disposed) return;
    const existingRoom = options.room();
    const state = options.state();

    if (
      existingRoom &&
      state.activeChannelId === tokenResponse.channelId &&
      state.activeCallId === tokenResponse.callId &&
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

    const generation = ++connectGeneration;

    // If switching channels, or if a previous disconnected room instance is
    // still hanging around after a failed reconnect, tear it down and build a
    // fresh Room. This gives retry/auto-rejoin the same clean slate as a manual
    // leave + join.
    if (existingRoom) {
      await existingRoom.disconnect();
      // An earlier leave may have cleared this room while we waited. The
      // latest join should still proceed; only a newer request supersedes it.
      if (disposed || generation !== connectGeneration) return;
      destroyRoom(existingRoom);
    }

    const targetRoom = new Room({
      audioCaptureDefaults: options.currentMicrophoneCaptureOptions(),
      publishDefaults: {
        // Noise-suppressed audio has a near-silent noise floor, which makes
        // Opus DTX (on by default) misread quiet speech onsets as silence and
        // clip them. Always-on frames cost little at speech bitrates.
        dtx: false,
      },
    });
    attachRoomListeners(targetRoom, {
      channelId: tokenResponse.channelId,
      callId: tokenResponse.callId,
    });
    options.setRoom(targetRoom);
    options.setActiveCall(tokenResponse.channelId, tokenResponse.callId);

    try {
      await targetRoom.connect(tokenResponse.serverUrl, tokenResponse.token);
      if (!isCurrentRoom(targetRoom) || generation !== connectGeneration)
        return;
      options.clearOptimisticJoin();
    } catch (e) {
      console.error('failed to connect to LiveKit room', e);
      destroyRoom(targetRoom);
      throw e;
    }

    // Sync participants that were already in the room when we connected.
    syncParticipantMap(targetRoom);

    // Sample receive-side decode stats for the life of the room; the sampler
    // flushes one summary analytics event when stopped at teardown.
    stopReceiverStats();
    stopReceiverStatsSampling = startReceiverStatsSampling(targetRoom, {
      channelId: tokenResponse.channelId ?? '',
      callId: tokenResponse.callId,
    });

    // Default to microphone on, video off as soon as the room is connected.
    options.setInitialMediaState(preferences);

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
    connectGeneration += 1;
    const room = options.room();
    if (!room) return;

    options.cancelPendingMediaSetup();
    try {
      await room.disconnect();
    } finally {
      // Tear down only the session this disconnect captured: a slow
      // room.disconnect() can settle after the user has rejoined, and
      // destroying the replacement session would strand a live connection
      // the UI no longer tracks.
      destroyRoom(room);
    }
  }

  function disconnectBeforeUnload() {
    connectGeneration += 1;
    const room = options.room();
    if (!room) return;

    options.cancelPendingMediaSetup();
    stopReceiverStats();
    room.disconnect();
  }

  function dispose() {
    disposed = true;
    options.cancelPendingMediaSetup();
    stopReceiverStats();
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

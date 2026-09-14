import type { CallTokenResponse } from '@service-call/client';
import { ConnectionState, type Room, RoomEvent } from 'livekit-client';
import { createComputed, createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLivekitJsCallController } from '../LivekitJsCallController';

const roomMocks = vi.hoisted(() => ({
  connect: vi.fn<Room['connect']>(),
  disconnect: vi.fn<Room['disconnect']>(),
}));

vi.mock('livekit-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('livekit-client')>();
  return {
    ...actual,
    Room: class extends actual.Room {
      connect = roomMocks.connect;
      disconnect = roomMocks.disconnect;
    },
  };
});

vi.mock('../call-audio-receiver-stats', () => ({
  startReceiverStatsSampling: vi.fn(() => vi.fn()),
}));

type ControllerOptions = Parameters<typeof createLivekitJsCallController>[0];

const token = (callId = 'call-1'): CallTokenResponse => ({
  channelId: 'channel-1',
  callId,
  roomName: callId,
  serverUrl: 'wss://call.example.test',
  token: 'test-token',
});

function transition(room: Room, state: ConnectionState) {
  room.state = state;
  room.emit(RoomEvent.ConnectionStateChanged, state);
}

function createHarness() {
  return createRoot((dispose) => {
    const [room, setRoom] = createSignal<Room | null>(null);
    const initialState: ReturnType<ControllerOptions['state']> = {
      activeChannelId: null,
      activeCallId: null,
      connectionState: ConnectionState.Disconnected,
    };
    const [state, setState] = createStore({ ...initialState });
    const observations: ReturnType<ControllerOptions['state']>[] = [];
    createComputed(() => observations.push({ ...state }));

    const options: ControllerOptions = {
      room,
      setRoom,
      state: () => state,
      currentMicrophoneCaptureOptions: () => ({}),
      isActiveConnectionState: (value) =>
        value !== ConnectionState.Disconnected,
      cancelPendingMediaSetup: vi.fn(),
      nextMediaSetupVersion: () => 1,
      finishLocalMediaSetup: vi.fn(async () => {}),
      destroyProcessors: vi.fn(),
      resetState: () => setState(initialState),
      setConnectionState: (value) => setState('connectionState', value),
      setActiveCall: (channelId, callId) => {
        setState('activeChannelId', channelId);
        setState('activeCallId', callId);
      },
      setDuplicateConnectCallId: (callId) => setState('activeCallId', callId),
      setInitialMediaState: vi.fn(),
      setRemoteParticipants: vi.fn(),
      setSharedWithTeam: vi.fn(),
      clearOptimisticJoin: vi.fn(),
      bumpTrackVersion: vi.fn(),
      bumpSpeakerVersion: vi.fn(),
      setScreenSharing: vi.fn(),
    };

    return {
      controller: createLivekitJsCallController(options),
      options,
      room,
      state,
      observations,
      dispose,
    };
  });
}

describe('LiveKit call session ownership', () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    roomMocks.connect.mockReset().mockImplementation(async function (
      this: Room
    ) {
      transition(this, ConnectionState.Connected);
    });
    roomMocks.disconnect.mockReset().mockImplementation(async function (
      this: Room
    ) {
      transition(this, ConnectionState.Disconnected);
      this.emit(RoomEvent.Disconnected);
    });
    harness = createHarness();
  });

  afterEach(() => {
    harness.controller.dispose();
    harness.dispose();
    vi.restoreAllMocks();
  });

  it('restores call identity atomically when the current room recovers after a disconnect', async () => {
    await harness.controller.connect(token());
    const room = harness.room()!;

    for (const state of [
      ConnectionState.SignalReconnecting,
      ConnectionState.Reconnecting,
      ConnectionState.Connected,
    ]) {
      transition(room, state);
      expect(harness.state.activeChannelId).toBe('channel-1');
      expect(harness.state.activeCallId).toBe('call-1');
    }

    await room.disconnect();
    expect(harness.state.activeChannelId).toBeNull();
    harness.observations.length = 0;

    transition(room, ConnectionState.Connected);

    expect(harness.observations).toEqual([
      {
        activeChannelId: 'channel-1',
        activeCallId: 'call-1',
        connectionState: ConnectionState.Connected,
      },
    ]);
  });

  it('ignores queued events from a room that has been replaced', async () => {
    await harness.controller.connect(token());
    const oldRoom = harness.room()!;
    const lateConnection = oldRoom
      .listeners(RoomEvent.ConnectionStateChanged)
      .at(-1)!;
    const lateDisconnect = oldRoom.listeners(RoomEvent.Disconnected).at(-1)!;
    const lateParticipant = oldRoom
      .listeners(RoomEvent.ParticipantConnected)
      .at(-1)! as () => void;
    const lateTrack = oldRoom
      .listeners(RoomEvent.TrackSubscribed)
      .at(-1)! as () => void;
    const lateSpeaker = oldRoom
      .listeners(RoomEvent.ActiveSpeakersChanged)
      .at(-1)!;

    await harness.controller.disconnect();
    await harness.controller.connect(token('call-2'));
    const currentRoom = harness.room();
    vi.mocked(harness.options.setRemoteParticipants).mockClear();
    vi.mocked(harness.options.bumpTrackVersion).mockClear();
    vi.mocked(harness.options.bumpSpeakerVersion).mockClear();

    lateConnection(ConnectionState.Connected);
    lateDisconnect();
    lateParticipant();
    lateTrack();
    lateSpeaker([]);

    expect(harness.room()).toBe(currentRoom);
    expect(harness.state).toEqual({
      activeChannelId: 'channel-1',
      activeCallId: 'call-2',
      connectionState: ConnectionState.Connected,
    });
    expect(harness.options.setRemoteParticipants).not.toHaveBeenCalled();
    expect(harness.options.bumpTrackVersion).not.toHaveBeenCalled();
    expect(harness.options.bumpSpeakerVersion).not.toHaveBeenCalled();
  });

  it('does not tear down a replacement when an earlier connect rejects late', async () => {
    const pending = Promise.withResolvers<void>();
    roomMocks.connect.mockImplementationOnce(() => pending.promise);
    const firstJoin = harness.controller.connect(token());
    await harness.controller.disconnect();
    await harness.controller.connect(token('call-2'));
    const currentRoom = harness.room();

    pending.reject(new Error('old connection failed'));
    await expect(firstJoin).rejects.toThrow('old connection failed');

    expect(harness.room()).toBe(currentRoom);
    expect(harness.state.activeCallId).toBe('call-2');
    expect(harness.state.connectionState).toBe(ConnectionState.Connected);
  });

  it('does not set up media when a connect completes after leaving', async () => {
    const pending = Promise.withResolvers<void>();
    roomMocks.connect.mockImplementationOnce(() => pending.promise);
    const joining = harness.controller.connect(token());
    await harness.controller.disconnect();
    pending.resolve();
    await joining;

    expect(harness.room()).toBeNull();
    expect(harness.options.finishLocalMediaSetup).not.toHaveBeenCalled();
    expect(harness.options.setInitialMediaState).not.toHaveBeenCalled();
    expect(harness.options.clearOptimisticJoin).not.toHaveBeenCalled();
  });

  it('reuses duplicate joins but gives a new call in the same channel its own room', async () => {
    await harness.controller.connect(token());
    const firstRoom = harness.room();
    await harness.controller.connect(token());
    expect(harness.room()).toBe(firstRoom);
    expect(roomMocks.connect).toHaveBeenCalledTimes(1);

    await harness.controller.connect(token('call-2'));
    expect(harness.room()).not.toBe(firstRoom);
    expect(harness.state.activeCallId).toBe('call-2');
    transition(harness.room()!, ConnectionState.SignalReconnecting);
    expect(harness.state.activeCallId).toBe('call-2');
  });
});

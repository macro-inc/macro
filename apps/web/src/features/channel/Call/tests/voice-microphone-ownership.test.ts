import type { CallTokenResponse } from '@service-call/client';
import type { Room } from 'livekit-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  acquire: vi.fn(),
  release: vi.fn(),
  roomCreated: vi.fn(),
}));
vi.mock('@core/util/audio-input-lease', () => ({
  acquireAudioInputLease: mock.acquire,
}));
vi.mock('../call-audio-receiver-stats', () => ({
  startReceiverStatsSampling: () => vi.fn(),
}));
vi.mock('livekit-client', () => ({
  Room: class {
    remoteParticipants = new Map();
    constructor() {
      mock.roomCreated();
    }
    on() {}
    removeAllListeners() {}
    async connect() {}
    async disconnect() {}
  },
  RoomEvent: {},
  Track: { Source: { ScreenShare: 'screen-share' } },
}));

import { createLivekitJsCallController } from '../LivekitJsCallController';

function setup() {
  let room: Room | null = null;
  const finishMedia = vi.fn(async () => {});
  const controller = createLivekitJsCallController({
    room: () => room,
    setRoom: (value) => {
      room = value;
    },
    state: () => ({
      activeChannelId: null,
      activeCallId: null,
      connectionState: 'disconnected' as Room['state'],
    }),
    currentMicrophoneCaptureOptions: () => ({}),
    isActiveConnectionState: () => false,
    cancelPendingMediaSetup: vi.fn(),
    nextMediaSetupVersion: () => 1,
    finishLocalMediaSetup: finishMedia,
    destroyProcessors: vi.fn(),
    resetState: vi.fn(),
    setConnectionState: vi.fn(),
    setActiveCall: vi.fn(),
    setDuplicateConnectCallId: vi.fn(),
    setInitialMediaState: vi.fn(),
    setRemoteParticipants: vi.fn(),
    clearOptimisticJoin: vi.fn(),
    bumpTrackVersion: vi.fn(),
    bumpSpeakerVersion: vi.fn(),
    setScreenSharing: vi.fn(),
  });
  return { controller, finishMedia };
}

const token = {
  channelId: 'channel',
  callId: 'call',
  token: 'test-only',
  serverUrl: 'wss://call.example',
} as CallTokenResponse;
beforeEach(() => {
  vi.clearAllMocks();
  mock.acquire.mockResolvedValue(mock.release);
});

describe('human calls share microphone ownership with agent voice', () => {
  it('does not open a room or capture audio when another session owns the microphone', async () => {
    mock.acquire.mockRejectedValueOnce(
      new Error('Microphone is already in use')
    );
    const { controller, finishMedia } = setup();
    await expect(controller.connect(token)).rejects.toThrow(
      'Microphone is already in use'
    );
    expect(mock.roomCreated).not.toHaveBeenCalled();
    expect(finishMedia).not.toHaveBeenCalled();
  });
  it('releases microphone ownership when a connected call ends', async () => {
    const { controller, finishMedia } = setup();
    await controller.connect(token);
    expect(mock.acquire).toHaveBeenCalledWith({
      required: false,
      waitMs: 3000,
    });
    expect(finishMedia).toHaveBeenCalledOnce();
    expect(mock.release).not.toHaveBeenCalled();
    await controller.disconnect();
    expect(mock.release).toHaveBeenCalledOnce();
  });
  it('releases a late microphone lease if a call was cancelled while waiting for it', async () => {
    let grant!: (release: () => void) => void;
    mock.acquire.mockReturnValueOnce(
      new Promise((resolve) => {
        grant = resolve;
      })
    );
    const { controller, finishMedia } = setup();
    const connecting = controller.connect(token);
    await controller.disconnect();
    grant(mock.release);
    await connecting;
    expect(mock.release).toHaveBeenCalledOnce();
    expect(mock.roomCreated).not.toHaveBeenCalled();
    expect(finishMedia).not.toHaveBeenCalled();
  });
});

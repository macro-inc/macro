import type { CallTokenResponse } from '@service-call/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCallSessionController } from '../CallSessionController';
import type { NativeCallState } from '../native-call-state';

const native = vi.hoisted(() => ({
  enabled: false,
  start: vi.fn(async () => undefined),
  end: vi.fn(async () => undefined),
}));
vi.mock('../use-callkit', () => ({
  isNativeIosCallKitEnabled: () => native.enabled,
  startNativeCallKitOutgoingCall: native.start,
  endCallKitCall: native.end,
  syncNativeCallStateAfterLeave: vi.fn(async () => undefined),
}));

const token: CallTokenResponse = {
  callId: 'call-1',
  channelId: null,
  roomName: 'room-1',
  serverUrl: 'wss://example.com',
  token: 'scoped-token',
  participantId: 'guest-1',
  shareToken: 'meeting-secret',
};

function setup() {
  const jsConnect = vi.fn(async () => undefined);
  const jsDisconnect = vi.fn(async () => undefined);
  const controller = createCallSessionController({
    nativeCall: {
      snapshot: () => null,
      bootstrapChannelId: () => null,
    } as unknown as NativeCallState,
    jsConnect,
    jsDisconnect,
    clearOptimisticJoin: vi.fn(),
  });
  return { controller, jsConnect, jsDisconnect };
}

beforeEach(() => {
  native.enabled = false;
  vi.clearAllMocks();
});

describe('call session platform selection', () => {
  it('passes prejoin media preferences to the browser controller', async () => {
    const { controller, jsConnect } = setup();
    const preferences = { microphoneEnabled: false, cameraEnabled: true };
    await controller.connectWithToken(token, preferences);
    expect(jsConnect).toHaveBeenCalledWith(token, preferences);
  });

  it('uses browser media for standalone meetings on iOS', async () => {
    native.enabled = true;
    const { controller, jsConnect, jsDisconnect } = setup();
    await controller.connectWithToken(token);
    await controller.disconnect();
    expect(jsConnect).toHaveBeenCalledWith(token, undefined);
    expect(jsDisconnect).toHaveBeenCalledOnce();
    expect(native.start).not.toHaveBeenCalled();
    expect(native.end).not.toHaveBeenCalled();
  });

  it('preserves native CallKit for existing channel calls', async () => {
    native.enabled = true;
    const { controller, jsConnect } = setup();
    await controller.connectWithToken({ ...token, channelId: 'channel-1' });
    expect(native.start).toHaveBeenCalledOnce();
    expect(jsConnect).not.toHaveBeenCalled();
  });

  it('uses browser media for a channel call joined from its public page', async () => {
    native.enabled = true;
    const { controller, jsConnect } = setup();
    await controller.connectWithToken(
      { ...token, channelId: 'channel-1' },
      { useBrowserSession: true }
    );
    expect(jsConnect).toHaveBeenCalledOnce();
    expect(native.start).not.toHaveBeenCalled();
  });
});

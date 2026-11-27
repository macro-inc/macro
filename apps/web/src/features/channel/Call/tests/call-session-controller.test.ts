import type { CallTokenResponse } from '@service-call/client';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCallSessionController,
  NATIVE_MEETING_START_TIMEOUT_MS,
} from '../CallSessionController';
import {
  createNativeCallState,
  type NativeCallState,
} from '../native-call-state';

const native = vi.hoisted(() => ({
  enabled: false,
  // Like the real call, records the call's key until native reports it.
  start: vi.fn(
    async (
      args: { channelId: string },
      nativeCall: { setBootstrapChannelId: (key: string) => void }
    ) => {
      nativeCall.setBootstrapChannelId(args.channelId);
    }
  ),
  end: vi.fn(async () => undefined),
}));
vi.mock('../callkit-drawer-theme', () => ({
  createCallKitDrawerTheme: () => () => ({}),
}));
vi.mock('../use-callkit', () => ({
  isNativeCallEnabled: () => native.enabled,
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
  started: false,
  shareToken: 'meeting-secret',
};

function setup() {
  const jsConnect = vi.fn(async () => undefined);
  const jsDisconnect = vi.fn(async () => undefined);
  const nativeCall = createRoot(() => createNativeCallState());
  const controller = createCallSessionController({
    nativeCall,
    jsConnect,
    jsDisconnect,
    clearOptimisticJoin: vi.fn(),
  });
  return { controller, jsConnect, jsDisconnect, nativeCall };
}

/** What iOS reports once CallKit starts a call: its id as an uppercase UUID. */
function reportNativeCall(
  nativeCall: NativeCallState,
  key: string,
  callId: string
) {
  nativeCall.setSnapshot({
    channelId: key,
    callId: callId.toUpperCase(),
    connectionState: 'connecting',
    isAudioMuted: false,
    isVideoMuted: true,
    videoOverlayMode: 'hidden',
  });
}

beforeEach(() => {
  native.enabled = false;
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

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

describe('meetings on native media', () => {
  const meetingKey = 'meeting:01a1f517-3048-7a99-afa9-5de4b147bf2f';
  const meetingToken = {
    ...token,
    callId: '01a1f517-3048-7a99-afa9-5de4b147bf2f',
  };

  it('starts CallKit under the meeting key and resolves once native reports the call', async () => {
    native.enabled = true;
    const { controller, jsConnect, nativeCall } = setup();
    native.start.mockImplementationOnce(async () => {
      reportNativeCall(nativeCall, meetingKey, meetingToken.callId);
    });
    await controller.connectWithToken(meetingToken, {
      nativeCallKey: meetingKey,
      channelTitle: 'Quick Call',
    });
    expect(native.start).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        channelId: meetingKey,
        callId: meetingToken.callId,
        channelTitle: 'Quick Call',
      }),
      nativeCall
    );
    expect(jsConnect).not.toHaveBeenCalled();
  });

  it('ends the CallKit call and fails the join when native never reports it', async () => {
    vi.useFakeTimers();
    native.enabled = true;
    const { controller } = setup();
    const connecting = controller.connectWithToken(meetingToken, {
      nativeCallKey: meetingKey,
    });
    const result = expect(connecting).rejects.toThrow(
      'Native call did not start'
    );
    await vi.advanceTimersByTimeAsync(NATIVE_MEETING_START_TIMEOUT_MS);
    await result;
    expect(native.end).toHaveBeenCalledOnce();
  });

  it('does not end a newer call when the meeting never started', async () => {
    vi.useFakeTimers();
    native.enabled = true;
    const { controller, nativeCall } = setup();
    const connecting = controller.connectWithToken(meetingToken, {
      nativeCallKey: meetingKey,
    });
    const result = expect(connecting).rejects.toThrow(
      'Native call did not start'
    );
    await vi.advanceTimersByTimeAsync(0);
    reportNativeCall(nativeCall, 'channel-2', 'call-2');
    await vi.advanceTimersByTimeAsync(NATIVE_MEETING_START_TIMEOUT_MS);
    await result;
    expect(native.end).not.toHaveBeenCalled();
  });

  it('stops waiting for the call when the meeting is left', async () => {
    native.enabled = true;
    const { controller } = setup();
    const connecting = controller.connectWithToken(meetingToken, {
      nativeCallKey: meetingKey,
    });
    const result = expect(connecting).rejects.toThrow(
      'Native call start cancelled'
    );
    await Promise.resolve();
    await controller.disconnect();
    await result;
    expect(native.end).toHaveBeenCalledOnce();
  });

  it('leaves a native meeting through CallKit', async () => {
    native.enabled = true;
    const { controller, jsConnect, nativeCall } = setup();
    native.start.mockImplementationOnce(async () => {
      reportNativeCall(nativeCall, meetingKey, meetingToken.callId);
    });
    await controller.connectWithToken(meetingToken, {
      nativeCallKey: meetingKey,
    });
    await controller.disconnect();
    expect(native.end).toHaveBeenCalledOnce();
    expect(jsConnect).not.toHaveBeenCalled();
  });

  it('keeps browser media for a meeting key off native platforms', async () => {
    const { controller, jsConnect } = setup();
    await controller.connectWithToken(meetingToken, {
      nativeCallKey: meetingKey,
    });
    expect(jsConnect).toHaveBeenCalledOnce();
    expect(native.start).not.toHaveBeenCalled();
  });
});

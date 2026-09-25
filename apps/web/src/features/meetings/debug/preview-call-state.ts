import type { BackgroundEffect, CallState } from '@channel/Call/CallContext';
import { createCallLifecycle } from '@channel/Call/call-lifecycle';
import { LK_CONNECTION_STATE } from '@channel/Call/livekit-loader';
import { RemoteParticipant, Room } from 'livekit-client';
import { createSignal, onCleanup } from 'solid-js';

/** Every media action stays in memory; this controller never connects to RTC. */
export function createPreviewCallState(): CallState {
  const room = new Room();
  onCleanup(() => {
    void room.disconnect();
  });
  const [muted, setMuted] = createSignal(false);
  const [videoMuted, setVideoMuted] = createSignal(true);
  const [sharing, setSharing] = createSignal(false);
  const [noise, setNoise] = createSignal(false);
  const [effect, setEffect] = createSignal<BackgroundEffect>({ type: 'none' });
  const participants = new Map(
    ['Priya Natarajan', 'Marcus Oduya', 'Dana Whitfield'].map((name, i) => [
      name,
      new RemoteParticipant(
        room.engine.client,
        `preview-${i}`,
        `guest:preview-${i}`,
        name
      ),
    ])
  );
  const noop = () => {};
  const asyncNoop = async () => {};
  return {
    room: () => null,
    connectionState: () => LK_CONNECTION_STATE.Connected,
    isInCall: () => true,
    activeChannelId: () => null,
    activeCallId: () => 'preview-call',
    remoteParticipants: () => participants,
    trackVersion: () => 0,
    isLocalSpeaking: () => false,
    isParticipantSpeaking: (person) => person.name === 'Priya Natarajan',
    isAudioMuted: muted,
    isVideoMuted: videoMuted,
    isScreenSharing: sharing,
    audioInputDevices: () => [],
    audioOutputDevices: () => [],
    videoInputDevices: () => [],
    activeAudioInputDeviceId: () => null,
    activeAudioOutputDeviceId: () => null,
    activeVideoInputDeviceId: () => null,
    meetingSession: { connectWithToken: asyncNoop, disconnect: asyncNoop },
    callLifecycle: createCallLifecycle({
      shouldRequestToken: () => false,
      requestToken: async () => {
        throw new Error('Preview cannot join calls');
      },
      connect: asyncNoop,
      disconnect: asyncNoop,
      leave: asyncNoop,
      lookup: async () => null,
      currentCall: () => undefined,
      beginJoin: noop,
      rollbackJoin: noop,
      setError: noop,
      watch: () => noop,
      onJoined: noop,
      onLeft: noop,
      reportError: noop,
    }),
    toggleAudio: async () => {
      setMuted((value) => !value);
    },
    toggleVideo: async () => {
      setVideoMuted((value) => !value);
    },
    toggleScreenShare: async () => {
      setSharing((value) => !value);
    },
    switchAudioInput: asyncNoop,
    switchAudioOutput: asyncNoop,
    switchVideoInput: asyncNoop,
    noiseSuppressionMode: () => (noise() ? 'browser' : 'off'),
    isNoiseSuppressed: noise,
    toggleNoiseSuppression: async () => {
      setNoise((value) => !value);
    },
    isConnecting: () => false,
    joinError: () => null,
    callPageChannelId: () => null,
    syncCallPageTab: noop,
    isCallPage: () => true,
    backgroundEffect: effect,
    setBackgroundEffect: async (value) => {
      setEffect(value);
    },
    isSharedWithTeam: () => false,
    setSharedWithTeam: noop,
  };
}

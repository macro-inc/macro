import type { BackgroundEffect } from '@core/media/background-effect';
import { createClient, fetchExchange } from '@urql/core';
import { createSignal, type ParentProps } from 'solid-js';

const [backgroundEffect, setBackgroundEffect] = createSignal<BackgroundEffect>({
  type: 'none',
});

const callId = '00000000-0000-7000-8000-0000000ca110';
const channelId = '00000000-0000-7000-8000-00000000c0c0';
let participantVolume = 1;
const participant = {
  identity: 'macro|member@example.com',
  name: 'Call participant',
  isAgent: false,
  getTrackPublication: () => undefined,
  getVolume: () => participantVolume,
  setVolume: (value: number) => {
    participantVolume = value;
  },
};
const room = {
  on: () => room,
  off: () => room,
  localParticipant: {
    identity: 'macro|me@example.com',
    getTrackPublication: () => undefined,
  },
};
const call = {
  activeCallId: () => callId,
  callLifecycle: {
    getState: () => ({ t: 'active', call: { channelId, callId } }),
    onLeave: () => () => {},
  },
  joinError: () => null,
  activeChannelId: () => channelId,
  isInCall: () => true,
  trackVersion: () => 0,
  connectionState: () => 'connected',
  room: () => room,
  remoteParticipants: () => new Map([[participant.identity, participant]]),
  isLocalSpeaking: () => false,
  isParticipantSpeaking: () => false,
  isConnecting: () => false,
  isAudioMuted: () => true,
  isVideoMuted: () => true,
  isScreenSharing: () => false,
  toggleAudio: async () => {},
  toggleVideo: async () => {},
  toggleScreenShare: async () => {},
  shareScreenAudio: () => false,
  setShareScreenAudio: () => {},
  audioInputDevices: () => [],
  audioOutputDevices: () => [],
  videoInputDevices: () => [],
  activeAudioInputDeviceId: () => '',
  activeAudioOutputDeviceId: () => '',
  activeVideoInputDeviceId: () => '',
  switchAudioInput: async () => {},
  switchAudioOutput: async () => {},
  switchVideoInput: async () => {},
  isNoiseSuppressed: () => false,
  toggleNoiseSuppression: async () => {},
  backgroundEffect,
  setBackgroundEffect: async (effect: BackgroundEffect) => {
    setBackgroundEffect(effect);
  },
  isSharedWithTeam: () => false,
};
export const CallProvider = (props: ParentProps) => props.children;
export const useCallContext = () => call;
export const useCallContextOptional = () => call;

// Only the flag and GraphQL transport boundaries are substituted. The Work
// controller, account filtering, arrivals, list, and call UI remain real.
export const useFeatureFlag = () => () => ({
  enabled: new URLSearchParams(location.search).get('work') !== 'off',
  loading: false,
});
const client = createClient({
  url: '/fixture/work',
  exchanges: [fetchExchange],
});
export const useWorkClient = () => () => client;

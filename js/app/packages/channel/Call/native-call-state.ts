import { createSignal } from 'solid-js';

export type NativeCallConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnecting';

// Keep this narrow: CallContext mirrors every field here into JS state.
export type NativeCallSnapshot = {
  channelId: string;
  callId: string;
  connectionState: NativeCallConnectionState;
  isAudioMuted: boolean;
  isVideoMuted: boolean;
  videoOverlayMode: 'hidden' | 'expanded' | 'minimized';
};

export const [nativeCallSnapshot, setNativeCallSnapshot] =
  createSignal<NativeCallSnapshot | null>(null);

// Tracks the channel as soon as CallKit tells JS about an answered call. The
// full snapshot can arrive later from the native LiveKit connection lifecycle.
export const [nativeCallChannelId, setNativeCallChannelId] = createSignal<
  string | null
>(null);

export const [
  nativeCallParticipantIdentities,
  setNativeCallParticipantIdentities,
] = createSignal<string[]>([]);

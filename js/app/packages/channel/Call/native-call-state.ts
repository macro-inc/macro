import { createSignal } from 'solid-js';

export type NativeCallConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnecting';

// Keep this narrow: CallContext reads these fields directly for native iOS calls.
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

// Tracks the channel from early native CallKit events before the full native
// media snapshot is available. nativeCallSnapshot remains authoritative once set.
export const [nativeCallBootstrapChannelId, setNativeCallBootstrapChannelId] =
  createSignal<string | null>(null);

export const [
  nativeCallParticipantIdentities,
  setNativeCallParticipantIdentities,
] = createSignal<string[]>([]);

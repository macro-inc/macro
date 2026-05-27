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
};

export const [nativeCallSnapshot, setNativeCallSnapshot] =
  createSignal<NativeCallSnapshot | null>(null);

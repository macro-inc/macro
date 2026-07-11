import {
  type Accessor,
  createComponent,
  createContext,
  createSignal,
  type ParentProps,
  type Setter,
  useContext,
} from 'solid-js';
import {
  type CallKitDrawerTheme,
  createCallKitDrawerTheme,
} from './callkit-drawer-theme';

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

export type NativeCallState = {
  snapshot: Accessor<NativeCallSnapshot | null>;
  setSnapshot: Setter<NativeCallSnapshot | null>;
  bootstrapChannelId: Accessor<string | null>;
  setBootstrapChannelId: Setter<string | null>;
  participantIdentities: Accessor<string[]>;
  setParticipantIdentities: Setter<string[]>;
  activeChannelId: Accessor<string | null>;
  drawerTheme: Accessor<CallKitDrawerTheme>;
};

const NativeCallContext = createContext<NativeCallState>();

function createNativeCallState(): NativeCallState {
  const [snapshot, setSnapshot] = createSignal<NativeCallSnapshot | null>(null);
  // Tracks the channel from early native CallKit events before the full native
  // media snapshot is available. snapshot remains authoritative once set.
  const [bootstrapChannelId, setBootstrapChannelId] = createSignal<
    string | null
  >(null);
  const [participantIdentities, setParticipantIdentities] = createSignal<
    string[]
  >([]);
  const drawerTheme = createCallKitDrawerTheme();

  return {
    snapshot,
    setSnapshot,
    bootstrapChannelId,
    setBootstrapChannelId,
    participantIdentities,
    setParticipantIdentities,
    activeChannelId: () => snapshot()?.channelId ?? bootstrapChannelId(),
    drawerTheme,
  };
}

export function NativeCallProvider(props: ParentProps) {
  const existing = useContext(NativeCallContext);
  if (existing) return props.children;

  const state = createNativeCallState();
  return createComponent(NativeCallContext.Provider, {
    get value() {
      return state;
    },
    get children() {
      return props.children;
    },
  });
}

export function useNativeCallState(): NativeCallState {
  const ctx = useContext(NativeCallContext);
  if (!ctx) {
    throw new Error(
      'useNativeCallState must be used within <NativeCallProvider />'
    );
  }
  return ctx;
}

export function useMaybeNativeCallState(): NativeCallState | undefined {
  return useContext(NativeCallContext);
}

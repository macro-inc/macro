import {
  type Accessor,
  createComponent,
  createContext,
  createSignal,
  onCleanup,
  type ParentProps,
  type Setter,
  untrack,
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
  /** Observe native updates directly, including the current snapshot. */
  onSnapshot: (
    listener: (snapshot: NativeCallSnapshot | null) => void
  ) => () => void;
  bootstrapChannelId: Accessor<string | null>;
  setBootstrapChannelId: Setter<string | null>;
  participantIdentities: Accessor<string[]>;
  setParticipantIdentities: Setter<string[]>;
  activeChannelId: Accessor<string | null>;
  drawerTheme: Accessor<CallKitDrawerTheme>;
};

const NativeCallContext = createContext<NativeCallState>();

export function createNativeCallState(): NativeCallState {
  const [snapshot, setSnapshot] = createSignal<NativeCallSnapshot | null>(null);
  const listeners = new Set<(snapshot: NativeCallSnapshot | null) => void>();
  onCleanup(() => listeners.clear());
  const updateSnapshot: NativeCallState['setSnapshot'] = (value) => {
    const next = setSnapshot(value);
    untrack(() => {
      for (const listener of [...listeners]) {
        if (listeners.has(listener)) listener(next);
      }
    });
    return next;
  };
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
    setSnapshot: updateSnapshot,
    onSnapshot: (listener) => {
      listeners.add(listener);
      untrack(() => listener(snapshot()));
      return () => {
        listeners.delete(listener);
      };
    },
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

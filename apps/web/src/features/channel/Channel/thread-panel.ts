import { usePreference } from '@app/lib/preferences/use-preference';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  type Accessor,
  createContext,
  createSignal,
  useContext,
} from 'solid-js';
import { createFocusRequest, type FocusRequest } from '../Thread/focus-request';

export type ChannelThreadPanel = {
  /** Touch devices show one pane, so threads stay inline there. */
  available: Accessor<boolean>;
  /** Threads open in a side panel instead of expanding inline. */
  enabled: Accessor<boolean>;
  setEnabled: (enabled: boolean) => void;
  /** The root message whose thread the panel shows, while it is open. */
  openThreadId: Accessor<string | undefined>;
  open: (threadId: string, options?: { reply?: boolean }) => void;
  close: () => void;
  /** Focus the panel's reply input once it mounts. */
  replyFocusRequest: FocusRequest;
};

const THREAD_PANEL_PREFERENCE = 'macro:pref:channel:thread-panel';

/**
 * Per-channel thread panel state. The layout choice is a user preference
 * shared by every channel; touch devices show one pane, so they keep threads
 * inline.
 */
export function createChannelThreadPanel(): ChannelThreadPanel {
  const [preferred, setPreferred] = usePreference(THREAD_PANEL_PREFERENCE, {
    default: false,
  });
  const [threadId, setThreadId] = createSignal<string>();
  const replyFocusRequest = createFocusRequest();
  const available = () => !isTouchDevice();
  const enabled = () => preferred() && available();

  return {
    available,
    enabled,
    setEnabled: (next) => {
      setPreferred(next);
      if (!next) setThreadId(undefined);
    },
    openThreadId: () => (enabled() ? threadId() : undefined),
    open: (id, options) => {
      setThreadId(id);
      if (options?.reply) replyFocusRequest.request();
    },
    close: () => setThreadId(undefined),
    replyFocusRequest,
  };
}

export const ChannelThreadPanelContext = createContext<ChannelThreadPanel>();

/** The enclosing channel's thread panel, when its host offers one. */
export function useChannelThreadPanel(): ChannelThreadPanel | undefined {
  return useContext(ChannelThreadPanelContext);
}

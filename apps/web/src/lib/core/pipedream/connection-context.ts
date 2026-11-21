import { createContext } from 'solid-js';

/** An agent session may handle connection in place and resume its own pending request. */
export const AppConnectionContext = createContext<{
  connect: (app: { appSlug: string; name: string }) => Promise<void>;
  disabled: () => boolean;
}>();

/**
 * Whether the reader may press the connect cards an agent session presented,
 * where that session is not open, e.g. in a channel: only its owner may.
 */
export const ConnectCardAccessContext = createContext<{
  allowed: () => boolean;
}>();

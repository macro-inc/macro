import { createContext } from 'solid-js';

/** The agent's reply a connect button sits in: its message, and when it was posted. */
export type ConnectingReply = { messageId: string; postedAt: string };

/** An agent session may handle connection in place and resume its own pending request. */
export const AppConnectionContext = createContext<{
  /** Connect `app`, for the reply whose button asked when it sits in one. */
  connect: (
    app: { appSlug: string; name: string },
    reply?: ConnectingReply
  ) => Promise<void>;
  disabled: () => boolean;
  /** Whether this surface connects in place right now; always, if absent. */
  enabled?: () => boolean;
  /** The app whose sign-in is open, by slug. */
  connecting?: () => string | undefined;
  /** The app whose last connection attempt failed, by slug. */
  failed?: () => string | undefined;
  /** Apps connected here whose agent then carried on, by slug. */
  resumed?: () => ReadonlySet<string>;
}>();

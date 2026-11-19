/** A saved routine's webhook URL as its trigger panel shows it. */
export type RoutineWebhookState = {
  /** Undefined while loading; null when the routine has no URL. */
  webhook:
    | { hookId: string; createdAt: string; lastUsedAt?: string | null }
    | null
    | undefined;
  /** The URL just made, with its secret: shown only until the panel closes. */
  created: { url: string; secret: string } | undefined;
  failed: boolean;
  pending: boolean;
  /** Loads the URL until the calling owner is disposed. */
  load: () => void;
  create: () => void;
  remove: () => void;
};

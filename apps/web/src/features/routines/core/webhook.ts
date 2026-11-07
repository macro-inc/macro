/** A saved routine's webhook URL as its trigger panel shows it. */
export type RoutineWebhookState = {
  /** Undefined while loading; null when the routine has no URL. */
  webhook: { tokenPrefix: string; createdAt: string } | null | undefined;
  /** The full URL just made, shown only until the panel closes. */
  createdUrl: string | undefined;
  failed: boolean;
  pending: boolean;
  create: () => void;
  remove: () => void;
};

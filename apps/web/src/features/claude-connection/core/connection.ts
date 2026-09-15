/** Safe connection metadata. Provider tokens are never sent to the browser. */
export type ClaudeConnectionStatus = {
  enabled: boolean;
  connected: boolean;
  ephemeral: boolean;
};

export type ClaudeLogin = {
  attemptId: string;
  authorizationUrl: string;
  expiresIn: number;
};

/** Narrow source contract; the controller does not know the query or transport library. */
export type ClaudeConnectionSource = {
  status: () => ClaudeConnectionStatus | undefined;
  failed: () => boolean;
  begin: () => Promise<ClaudeLogin>;
  complete: (attemptId: string, code: string) => Promise<void>;
  disconnect: () => Promise<void>;
  refresh: () => Promise<void>;
};

/** Captured document-session authority supplied by the query layer. */
export type DocumentSyncAuthorization = {
  /** Never returns a persisted token; every reconnect is freshly authorized. */
  getToken: () => Promise<string>;
  isCurrent: () => boolean;
  /** Fresh grants must permit the edits the cached view allowed. */
  canWrite: () => boolean;
  onInvalidated: (listener: () => void) => () => void;
};

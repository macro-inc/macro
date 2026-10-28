import {
  type InitialSync,
  type LiveSyncSource,
  type SyncError,
  SyncSourceStatus,
} from '@macro-inc/collaboration/collab/source';
import { errAsync, okAsync, type ResultAsync } from 'neverthrow';
import type { DocumentSyncAuthorization } from './authorization';

/** Prevent a document source from being reused by a later signed-in session. */
export function guardDocumentSyncSource(
  source: LiveSyncSource,
  initialSync: () => ResultAsync<InitialSync, SyncError>,
  authorization: DocumentSyncAuthorization
): {
  source: LiveSyncSource;
  doInitialSync: () => ResultAsync<InitialSync, SyncError>;
} {
  let disposed = false;
  let unsubscribe = () => {};
  const current = () => !disposed && authorization.isCurrent();
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    source.cleanup();
  };
  unsubscribe = authorization.onInvalidated(cleanup);
  if (disposed) unsubscribe();

  function denied<T>(): ResultAsync<T, SyncError> {
    return errAsync({
      type: 'authorization_error',
      reason: 'Document session is no longer authorized',
    });
  }
  function read<T>(
    operation: () => ResultAsync<T, SyncError>
  ): ResultAsync<T, SyncError> {
    if (!current()) {
      cleanup();
      return denied();
    }
    return operation().andThen((value) =>
      current() ? okAsync(value) : denied<T>()
    );
  }

  return {
    doInitialSync: () => read(initialSync),
    source: {
      documentId: source.documentId,
      status: () =>
        current() ? source.status() : SyncSourceStatus.Disconnected,
      listen: (listener) =>
        current()
          ? source.listen((event) => {
              if (current()) listener(event);
            })
          : () => {},
      pushUpdate: async (updates) => {
        if (!current()) {
          cleanup();
          return false;
        }
        if (source.status() !== SyncSourceStatus.Connected) {
          // User activity can revive an exhausted retry budget, but must not
          // queue raw edits on a socket awaiting fresh authorization.
          source.reconnect();
          return false;
        }
        if (!authorization.canWrite()) return false;
        const acknowledged = await source.pushUpdate(updates);
        return current() && acknowledged;
      },
      pushAwareness: (value) => {
        if (current()) source.pushAwareness(value);
      },
      registerPeerId: (value) => {
        if (current()) source.registerPeerId(value);
      },
      requestSnapshot: () => read(source.requestSnapshot),
      requestUpdatesSince: (version) =>
        read(() => source.requestUpdatesSince(version)),
      reconnect: () => {
        if (current()) source.reconnect();
      },
      cleanup,
    },
  };
}

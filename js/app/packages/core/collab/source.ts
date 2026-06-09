import type { Listen } from '@solid-primitives/event-bus';
import type { VersionVector } from 'loro-crdt';
import type { ResultAsync } from 'neverthrow';
import type { Accessor } from 'solid-js';
import type { RawUpdate } from './shared';

const _SYNC_SOURCE_EVENT_TYPES = {
  Connect: 'connect',
  Awareness: 'awareness',
  Reconnect: 'reconnect',
  Disconnect: 'disconnect',
  IncrementalSnapshot: 'incremental_snapshot',
  Update: 'update',
  Error: 'error',
} as const;

export type InitialSync = {
  snapshot: RawUpdate;
  awareness: RawUpdate;
};

export type SyncSourceEvent =
  | ({ type: 'connect' } & InitialSync)
  | { type: 'awareness'; awareness: RawUpdate }
  | ({ type: 'reconnect' } & InitialSync)
  | { type: 'disconnect' }
  | { type: 'incremental_snapshot'; snapshot: RawUpdate }
  | { type: 'update'; update: RawUpdate }
  | { type: 'error'; error: Error };

export type AuthorizationError = {
  type: 'authorization_error';
  reason: string;
};

export type ConnectionFailedError = {
  type: 'connection_failed';
};

export type TimeoutError = {
  type: 'timeout';
  duration: number;
};

export type SyncError =
  | ConnectionFailedError
  | TimeoutError
  | { type: 'invalid_snapshot'; details: string }
  | { type: 'unknown'; error: Error }
  | AuthorizationError;

export const SyncError = {
  connectionFailed: (): SyncError => ({
    type: 'connection_failed',
  }),
  timeout: (duration: number): TimeoutError => ({ type: 'timeout', duration }),
  invalidSnapshot: (details: string): SyncError => ({
    type: 'invalid_snapshot',
    details,
  }),
  unknown: (error: Error): SyncError => ({ type: 'unknown', error }),
} as const;

export enum SyncSourceStatus {
  Connected,
  Disconnected,
  Connecting,
}

export type LiveSyncSource = {
  readonly documentId: string;
  readonly listen: Listen<SyncSourceEvent>;
  /** Sends a batch of updates to the server. Resolves true if acked, false if timed out. */
  pushUpdate: (updates: RawUpdate[]) => Promise<boolean>;
  pushAwareness: (awareness: RawUpdate) => void;
  registerPeerId: (peerId: bigint) => void;
  status: Accessor<SyncSourceStatus>;
  requestUpdatesSince: (
    version: VersionVector
  ) => ResultAsync<RawUpdate, TimeoutError>;
  requestSnapshot: () => ResultAsync<RawUpdate, TimeoutError>;
  reconnect: () => void;
  cleanup: () => void;
};

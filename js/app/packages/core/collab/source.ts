import type { Listen } from '@solid-primitives/event-bus';
import type { Frontiers } from 'loro-crdt';
import type { ResultAsync } from 'neverthrow';
import type { Accessor } from 'solid-js';
import type { RawUpdate } from './shared';

export const SYNC_SOURCE_EVENT_TYPES = {
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

export type SyncSourceEventType = SyncSourceEvent['type'];

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

export type MissingAckError = {
  type: 'missing_ack';
  update: RawUpdate;
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

export type SyncSource = {
  readonly listen: Listen<SyncSourceEvent>;
  readonly documentId: string;

  /** Pushes an update to the source
   *
   * @param update - The update to push, should be a [RawUpdate] from [LoroDoc.export()]
   **/
  pushUpdate: (
    update: RawUpdate,
    peerId: bigint
  ) => ResultAsync<void, MissingAckError>;

  /** Pushes an awareness update to the source
   *
   * @param awareness - The awareness update to push, should be a [RawUpdate] from [EphemeralStore.encode()]
   **/
  pushAwareness: (awareness: RawUpdate) => void;

  /**
   * Registers a new peerId that is associated with the current source
   *
   * @param peerId - The peerId to register
   **/
  registerPeerId: (peerId: bigint) => void;

  status: Accessor<SyncSourceStatus>;

  requestUpdatesSince: (
    version: Frontiers
  ) => ResultAsync<RawUpdate, TimeoutError>;

  /** Requests a shallow snapshot from the source */
  requestSnapshot: () => ResultAsync<RawUpdate, TimeoutError>;

  reconnect: () => void;

  cleanup: () => void;
};

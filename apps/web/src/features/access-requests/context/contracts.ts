import type { Accessor } from 'solid-js';
import type {
  AccessLevel,
  AccessRequest,
  DirectAccess,
  RequestState,
} from '../core/types';

/** Narrow capabilities consumed by the Share views and their controllers. */
export type SharingSource = {
  state: Accessor<RequestState | undefined>;
  grants: Accessor<DirectAccess[]>;
  loading: Accessor<boolean>;
  busy: Accessor<boolean>;
  error: Accessor<string | undefined>;
  refresh(): Promise<void>;
  submit(level: AccessLevel, revision?: number): Promise<unknown>;
  cancel(revision: number): Promise<unknown>;
  resolve(request: AccessRequest, level: AccessLevel | null): Promise<unknown>;
  setGrant(userId: string, level: AccessLevel | null): Promise<unknown>;
  nextPage(): void;
  firstPage(): void;
};

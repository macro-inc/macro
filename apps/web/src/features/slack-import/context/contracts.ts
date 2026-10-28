import type { Accessor } from 'solid-js';
import type {
  ArchiveDiscovery,
  ArchiveLimits,
  ConversationMetadata,
} from '../core/export';
import type {
  ConversationSeal,
  PartDescriptor,
  PartLimits,
} from '../core/worker-protocol';

export type ImportJobStatus =
  | 'uploading'
  | 'processing'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'cancelling'
  | 'cancelled';

export type ImportLimits = ArchiveLimits &
  PartLimits & { registrationBatch: number };
export type ImportSourceIdentity =
  | { kind: 'known'; sourceId: string }
  | { kind: 'confirmed_unknown' };
export type ImportSourceBinding = ImportSourceIdentity | { kind: 'unbound' };

export type ImportConversation = {
  slackChannelId: string;
  name: string;
  kind: ConversationMetadata['kind'];
  archived: boolean;
  channelId: string | undefined;
  status:
    | 'awaiting_uploads'
    | 'queued'
    | 'importing'
    | 'completed'
    | 'skipped'
    | 'failed';
  counters: {
    processed: number;
    imported: number;
    duplicates: number;
    skipped: number;
    reactions: number;
  };
  partCount: number | undefined;
  verifiedParts: number;
  searchStatus: 'not_needed' | 'pending' | 'submitted' | 'completed' | 'failed';
  error: string | undefined;
  warnings: readonly string[];
};

export type ImportJob = {
  source: ImportSourceIdentity;
  includeMessageHistory: boolean;
  teamId: string;
  jobId: string;
  status: ImportJobStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  registrationClosed: boolean;
  usersVerified: boolean;
  limits: ImportLimits;
  conversations: readonly ImportConversation[];
};

export type ImportPage = {
  jobs: readonly ImportJob[];
  limits: ImportLimits;
  sourceBinding: ImportSourceBinding;
  nextCursor: string | undefined;
};

export type ImportSourceInputs = {
  teamId: Accessor<string | undefined>;
  jobId: Accessor<string | undefined>;
  /** Includes the host's admin/feature gate. Disabled sources expose no cached receipts. */
  enabled: Accessor<boolean>;
  before?: Accessor<string | undefined>;
};

export type ImportSource = {
  /** Undefined until a receipt for the current enabled scope is available. */
  page: Accessor<ImportPage | undefined>;
  job: Accessor<ImportJob | undefined>;
  isLoading: Accessor<boolean>;
  /** A background error may coexist with available data. */
  error: Accessor<Error | undefined>;
  refresh(): Promise<void>;
};

export type ImportScope = { teamId: string; jobId: string };
export type CreateImport = {
  idempotencyToken: string;
  includeMessageHistory: boolean;
  source: ImportSourceIdentity;
  conversations: ConversationMetadata[];
};
export type ImportUploadId =
  | { kind: 'users' }
  | { kind: 'conversation_part'; slackChannelId: string; partIndex: number };
export type ImportUploadDescriptor = {
  upload: ImportUploadId;
  sha256: string;
  byteLength: number;
  recordCount?: number | null;
};
/** Bytes for parts prepared so far, not the compressed ZIP size. */
export type ImportUploadProgress = {
  loaded: number;
  total: number;
  indeterminate: boolean;
};

export type ImportUploadOptions = {
  signal?: AbortSignal;
  onProgress?: (
    progress:
      | { kind: 'bytes'; loaded: number; total: number }
      | { kind: 'indeterminate'; total: number }
  ) => void;
};

export class ImportUploadError extends Error {
  constructor(
    public readonly code:
      | 'ABORTED'
      | 'EXPIRED'
      | 'SIZE_MISMATCH'
      | 'INVALID_GRANT'
      | 'NETWORK_ERROR'
      | 'HTTP_ERROR',
    public readonly status?: number
  ) {
    super(`Slack import upload failed: ${code}`);
    this.name = 'ImportUploadError';
  }
}

/** A bounded, short-lived capability, not a transport URL or storage key. */
export type ImportUpload = {
  descriptor: ImportUploadDescriptor;
  expiresAt: string;
  put(
    blob: Blob,
    options?: ImportUploadOptions
  ): Promise<'uploaded' | 'already-exists'>;
};

/** One selected file/session. Callbacks are backpressured and must finish before proceeding. */
export type ArchiveSource = {
  discover(file: Blob, limits: ArchiveLimits): Promise<ArchiveDiscovery>;
  prepare(options: {
    selectedIds: string[];
    includeMessageHistory: boolean;
    partLimits: PartLimits;
    part(descriptor: PartDescriptor, blob: Blob): Promise<void>;
    seal(seal: ConversationSeal): Promise<void>;
  }): Promise<void>;
  /** Stops pending work, rejects outstanding requests and deletes scratch storage. */
  dispose(): Promise<void>;
};

export type ImportCommands = {
  create(teamId: string, request: CreateImport): Promise<ImportJob>;
  register(
    scope: ImportScope,
    descriptors: ImportUploadDescriptor[]
  ): Promise<ImportUpload[]>;
  /** Required after either PUT outcome; seals may be submitted with no uploads. */
  complete(
    scope: ImportScope,
    uploads: ImportUploadId[],
    seal?: ConversationSeal
  ): Promise<ImportJob>;
  finalize(scope: ImportScope): Promise<ImportJob>;
  cancel(scope: ImportScope): Promise<ImportJob>;
};

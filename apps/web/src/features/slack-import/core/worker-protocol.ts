import type {
  ArchiveDiscovery,
  ArchiveErrorCode,
  ArchiveLimits,
} from './export';

export type PartLimits = {
  partBytes: number;
  partRecords: number;
  recordBytes: number;
};

export type PartDescriptor = {
  upload: {
    kind: 'conversation_part';
    slackChannelId: string;
    partIndex: number;
  };
  sha256: string;
  byteLength: number;
  recordCount: number;
};

export type ConversationSeal = {
  slackChannelId: string;
  partCount: number;
  manifestSha256: string;
};

/** One archive session per worker; every response echoes the caller's session ID. */
export type ArchiveWorkerRequest =
  | {
      type: 'discover';
      sessionId: string;
      archive: Blob;
      limits?: ArchiveLimits;
    }
  | {
      type: 'read_history';
      sessionId: string;
      selectedIds: string[];
      includeMessageHistory: boolean;
      partLimits?: PartLimits;
    }
  | { type: 'ack_part'; sessionId: string; sequence: number }
  | { type: 'cancel'; sessionId: string };

export type ArchiveWorkerResponse =
  | { type: 'discovered'; sessionId: string; discovery: ArchiveDiscovery }
  | {
      type: 'part';
      sessionId: string;
      sequence: number;
      descriptor: PartDescriptor;
      bytes: Uint8Array<ArrayBuffer>;
    }
  | { type: 'seal'; sessionId: string; seal: ConversationSeal }
  | { type: 'complete'; sessionId: string }
  | { type: 'cancelled'; sessionId: string }
  | {
      type: 'error';
      sessionId: string;
      code: ArchiveErrorCode;
      message: string;
    };

/** A part must be durably consumed before ack_part; at most one part is outstanding.
 * No network/upload capability belongs in discovery. Use disposeSlackImportWorker
 * on owner disposal so forced termination also deletes session scratch storage.
 */
export type ArchiveWorkerPort = {
  postMessage(message: ArchiveWorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ArchiveWorkerRequest>) => void) | null;
};

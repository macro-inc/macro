import { createSignal } from 'solid-js';
import { vi } from 'vitest';
import type {
  ArchiveSource,
  ImportCommands,
  ImportJob,
  ImportLimits,
  ImportSource,
  ImportSourceBinding,
  ImportUpload,
} from '../context/contracts';
import type { ArchiveDiscovery } from '../core/export';
import type { ConversationSeal, PartDescriptor } from '../core/worker-protocol';

export function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export const importLimits: ImportLimits = {
  conversations: 2000,
  jsonBytes: 33554432,
  selectedBytes: 2147483648,
  zipEntries: 100000,
  partBytes: 16777216,
  partRecords: 20000,
  recordBytes: 1048576,
  registrationBatch: 50,
};

export function archiveDiscovery(): ArchiveDiscovery {
  return {
    source: { kind: 'unknown' },
    users: [],
    dayEntries: [],
    conversations: [
      {
        slackChannelId: 'C123',
        kind: 'public_channel',
        name: 'general',
        folder: 'general',
        memberIds: [],
        creatorId: null,
        createdAt: null,
        archived: false,
        messageCount: null,
      },
    ],
  };
}

export function importReceipt(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    teamId: 'team',
    source: { kind: 'confirmed_unknown' },
    includeMessageHistory: true,
    jobId: 'job',
    status: 'uploading',
    revision: 1,
    createdAt: '',
    updatedAt: '',
    registrationClosed: false,
    usersVerified: false,
    limits: importLimits,
    conversations: [
      {
        slackChannelId: 'C123',
        name: 'general',
        kind: 'public_channel',
        archived: false,
        channelId: undefined,
        status: 'awaiting_uploads',
        counters: {
          processed: 0,
          imported: 0,
          duplicates: 0,
          skipped: 0,
          reactions: 0,
        },
        partCount: undefined,
        verifiedParts: 0,
        searchStatus: 'not_needed',
        error: undefined,
        warnings: [],
      },
    ],
    ...overrides,
  };
}

export function historyPart(partIndex = 0): PartDescriptor {
  return {
    upload: { kind: 'conversation_part', slackChannelId: 'C123', partIndex },
    sha256: 'a'.repeat(64),
    byteLength: 2,
    recordCount: 1,
  };
}

export function historySeal(partCount = 1): ConversationSeal {
  return { slackChannelId: 'C123', partCount, manifestSha256: 'b'.repeat(64) };
}

export function fakeImportSources() {
  const [observed, setObserved] = createSignal<ImportJob>();
  const [binding, setBinding] = createSignal<ImportSourceBinding>({
    kind: 'unbound',
  });
  const events: string[] = [];
  const stop = new AbortController();
  const release = vi.fn();
  const put = vi.fn<ImportUpload['put']>(async () => 'uploaded');
  const archive = {
    discover: vi.fn<ArchiveSource['discover']>(async () => archiveDiscovery()),
    prepare: vi.fn<ArchiveSource['prepare']>(async (options) => {
      if (options.includeMessageHistory)
        await options.part(historyPart(), new Blob(['[]']));
      await options.seal(historySeal(options.includeMessageHistory ? 1 : 0));
    }),
    dispose: vi.fn<ArchiveSource['dispose']>(async () => {
      stop.abort();
    }),
  };
  let receipt = importReceipt();
  function update(overrides: Partial<ImportJob>): ImportJob {
    receipt = { ...receipt, ...overrides, revision: receipt.revision + 1 };
    return receipt;
  }
  const commands = {
    create: vi.fn<ImportCommands['create']>(async (_, request) => {
      events.push('create');
      receipt = {
        ...receipt,
        source: structuredClone(request.source),
        includeMessageHistory: request.includeMessageHistory,
        conversations: request.conversations.map((conversation) => ({
          ...importReceipt().conversations[0],
          slackChannelId: conversation.slackChannelId,
          name: conversation.name,
          kind: conversation.kind,
          archived: conversation.archived,
        })),
      };
      return receipt;
    }),
    register: vi.fn<ImportCommands['register']>(async (_, descriptors) => {
      return descriptors.map((descriptor) => {
        events.push(`register:${descriptor.upload.kind}`);
        return { descriptor: structuredClone(descriptor), expiresAt: '', put };
      });
    }),
    complete: vi.fn<ImportCommands['complete']>(async (_, uploads, seal) => {
      if (seal) {
        events.push(`seal:${seal.partCount}`);
        return update({
          conversations: receipt.conversations.map((conversation) => ({
            ...conversation,
            partCount: seal.partCount,
          })),
        });
      }
      events.push(`complete:${uploads[0]?.kind}`);
      return update({
        usersVerified:
          receipt.usersVerified ||
          uploads.some((upload) => upload.kind === 'users'),
      });
    }),
    finalize: vi.fn<ImportCommands['finalize']>(async () => {
      events.push('finalize');
      return update({ registrationClosed: true, status: 'processing' });
    }),
    cancel: vi.fn<ImportCommands['cancel']>(async () => {
      events.push('cancel');
      return update({ registrationClosed: true, status: 'cancelled' });
    }),
  };
  const source: ImportSource = {
    page: () => undefined,
    job: observed,
    isLoading: () => false,
    error: () => undefined,
    refresh: vi.fn(async () => {}),
  };
  return {
    teamId: 'team',
    limits: importLimits,
    archive,
    commands,
    source,
    sourceBinding: binding,
    setBinding,
    setObserved,
    put,
    events,
    stop,
    protectFile: vi.fn(() => release),
    release,
    newToken: vi.fn(() => 'stable-token'),
    onJobCreated: vi.fn(async (_job: ImportJob) => {}),
    onFinalized: vi.fn(async (_job: ImportJob) => {}),
  };
}

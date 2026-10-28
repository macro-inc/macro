import { createSignal, Suspense } from 'solid-js';
import { render } from 'solid-js/web';
import type {
  ImportCommands,
  ImportJob,
  ImportLimits,
} from '../../../src/features/slack-import/context/contracts';
import { ImportProvider } from '../../../src/features/slack-import/context/import-context';
import { DEFAULT_ARCHIVE_LIMITS } from '../../../src/features/slack-import/core/export';
import { createArchiveSource } from '../../../src/features/slack-import/queries/archive-source';
import { ImportDialog } from '../../../src/features/slack-import/views/import-dialog';

// Real dialog/controller/ZIP worker, deterministic fake server. Serialization and
// server authorization are independently covered by adapter and PostgreSQL tests.
const limits: ImportLimits = {
  ...DEFAULT_ARCHIVE_LIMITS,
  partBytes: 16777216,
  partRecords: 20000,
  recordBytes: 1048576,
  registrationBatch: 50,
};
const saved = localStorage.getItem('slack-test-job');
const [job, setJob] = createSignal<ImportJob | undefined>(
  saved ? JSON.parse(saved) : undefined
);
function record(kind: string, body: unknown): void {
  const writes = JSON.parse(localStorage.getItem('slack-test-writes') ?? '[]');
  writes.push({ kind, body });
  localStorage.setItem('slack-test-writes', JSON.stringify(writes));
}
function persist(receipt: ImportJob): ImportJob {
  const next = { ...receipt, revision: receipt.revision + 1 };
  localStorage.setItem('slack-test-job', JSON.stringify(next));
  setJob(next);
  return next;
}
const commands: ImportCommands = {
  async create(teamId, request) {
    record('create', request);
    return persist({
      teamId,
      jobId: crypto.randomUUID(),
      source: request.source,
      includeMessageHistory: request.includeMessageHistory,
      status: 'uploading',
      revision: 0,
      createdAt: '2026-09-30T00:00:00Z',
      updatedAt: '2026-09-30T00:00:00Z',
      registrationClosed: false,
      usersVerified: false,
      limits,
      conversations: request.conversations.map((metadata) => ({
        slackChannelId: metadata.slackChannelId,
        name: metadata.name,
        kind: metadata.kind,
        archived: metadata.archived,
        channelId: undefined,
        status: 'awaiting_uploads',
        counters: {
          processed: 0,
          imported: 0,
          skipped: 0,
          duplicates: 0,
          reactions: 0,
        },
        verifiedParts: 0,
        partCount: undefined,
        searchStatus: 'not_needed',
        error: undefined,
        warnings: [],
      })),
    });
  },
  async register(_scope, descriptors) {
    record('register', descriptors);
    return descriptors.map((descriptor) => ({
      descriptor,
      expiresAt: '2099-01-01T00:00:00Z',
      async put() {
        return 'uploaded' as const;
      },
    }));
  },
  async complete(_scope, uploads, seal) {
    record('complete', { uploads, seal });
    return persist({
      ...job()!,
      usersVerified:
        job()!.usersVerified ||
        uploads.some((upload) => upload.kind === 'users'),
      conversations: job()!.conversations.map((conversation) => ({
        ...conversation,
        partCount:
          seal?.slackChannelId === conversation.slackChannelId
            ? seal.partCount
            : conversation.partCount,
      })),
    });
  },
  async finalize() {
    record('finalize', {});
    return persist({
      ...job()!,
      status: 'completed_with_errors',
      registrationClosed: true,
      conversations: job()!.conversations.map((conversation) => ({
        ...conversation,
        status: conversation.slackChannelId === 'CC' ? 'failed' : 'completed',
        error:
          conversation.slackChannelId === 'CC' ? 'invalid_input' : undefined,
      })),
    });
  },
  async cancel() {
    record('cancel', {});
    return persist({
      ...job()!,
      status: 'cancelled',
      registrationClosed: true,
    });
  },
};

render(
  () => (
    <Suspense>
      <ImportProvider
        context={{
          createSource: (inputs) => ({
            commands,
            source: {
              page: () => ({
                jobs: job() ? [job()!] : [],
                limits,
                sourceBinding: { kind: 'unbound' },
                nextCursor: undefined,
              }),
              job: () => (job()?.jobId === inputs.jobId() ? job() : undefined),
              isLoading: () => false,
              error: () => undefined,
              async refresh() {},
            },
          }),
          createArchive: createArchiveSource,
          protectFile: () => () => {},
          newToken: () => crypto.randomUUID(),
        }}
      >
        <ImportDialog
          teamId="team"
          onCompleted={async () => {}}
          channelHref={() => undefined}
        />
      </ImportProvider>
    </Suspense>
  ),
  document.getElementById('root')!
);

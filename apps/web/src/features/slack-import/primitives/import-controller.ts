import { type Accessor, createMemo, createSignal, onCleanup } from 'solid-js';
import type {
  ArchiveSource,
  CreateImport,
  ImportCommands,
  ImportJob,
  ImportLimits,
  ImportSource,
  ImportSourceBinding,
  ImportUploadDescriptor,
  ImportUploadProgress,
} from '../context/contracts';
import { ImportUploadError } from '../context/contracts';
import type { ArchiveDiscovery } from '../core/export';
import type { ConversationSeal, PartDescriptor } from '../core/worker-protocol';

export type ImportPhase =
  | 'idle'
  | 'discovering'
  | 'selecting'
  | 'preparing'
  | 'uploading'
  | 'interrupted'
  | 'finalizing'
  | 'cancelling'
  | 'monitoring'
  | 'terminal'
  | 'disposed';

export type ImportSkip = {
  slackChannelId: string;
  reason:
    | 'unsupported_dm'
    | 'target_unavailable'
    | 'uploads_incomplete'
    | 'skipped';
};

export type ImportControllerOptions = {
  teamId: string;
  limits: ImportLimits;
  sourceBinding: Accessor<ImportSourceBinding>;
  archive: ArchiveSource;
  commands: ImportCommands;
  source: ImportSource;
  /** Acquire both the automatic-reload hold and beforeunload listener. */
  protectFile(): () => void;
  newToken(): string;
  /** Point the host's job source at this receipt. Failure must not retry creation. */
  onJobCreated?(job: ImportJob): Promise<void>;
  /** Presentation/cache failures here never undo successful server writes. */
  onFinalized?(job: ImportJob): Promise<void>;
};

export type ImportController = {
  phase: Accessor<ImportPhase>;
  discovery: Accessor<ArchiveDiscovery | undefined>;
  job: Accessor<ImportJob | undefined>;
  jobId: Accessor<string | undefined>;
  error: Accessor<string | undefined>;
  warning: Accessor<string | undefined>;
  skips: Accessor<readonly ImportSkip[]>;
  uploadProgress: Accessor<ImportUploadProgress>;
  discover(file: Blob): Promise<void>;
  start(selection: {
    selectedIds: string[];
    includeMessageHistory?: boolean;
    sourceConfirmed: boolean;
  }): Promise<void>;
  /** Recover an uncertain create response with the original token, never a new job. */
  recoverJob(): Promise<void>;
  finalizeWithSkips(): Promise<void>;
  cancel(): Promise<void>;
  refresh(): Promise<void>;
  dispose(): Promise<void>;
};

function terminal(job: ImportJob): boolean {
  return ['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(
    job.status
  );
}

function descriptorKey(descriptor: ImportUploadDescriptor): string {
  const id = descriptor.upload;
  return id.kind === 'users' ? 'users' : `${id.slackChannelId}:${id.partIndex}`;
}

function descriptorSignature(descriptor: ImportUploadDescriptor): string {
  return `${descriptorKey(descriptor)}:${descriptor.sha256}:${descriptor.byteLength}:${descriptor.recordCount ?? ''}`;
}

function unsupportedDirectMessages(discovery: ArchiveDiscovery): Set<string> {
  const emails = new Map(
    discovery.users.map((user) => [
      user.id,
      user.is_bot || user.id === 'USLACKBOT'
        ? undefined
        : user.profile?.email?.toLowerCase(),
    ])
  );
  return new Set(
    discovery.conversations
      .filter((conversation) => {
        if (conversation.kind !== 'direct_message') return false;
        const members = conversation.memberIds.map((id) => emails.get(id));
        return (
          members.length !== 2 ||
          members.some((email) => !email) ||
          members[0] === members[1]
        );
      })
      .map((conversation) => conversation.slackChannelId)
  );
}

/** One controller per file. At most two uploads run: users and one backpressured history part. */
export function createImportController(
  options: ImportControllerOptions
): ImportController {
  const { archive, commands, source } = options;
  const [stage, setStage] = createSignal<ImportPhase>('idle');
  const [discovery, setDiscovery] = createSignal<ArchiveDiscovery>();
  const [receipt, setReceipt] = createSignal<ImportJob>();
  const [error, setError] = createSignal<string>();
  const [warning, setWarning] = createSignal<string>();
  const [uploadProgress, setUploadProgress] =
    createSignal<ImportUploadProgress>({
      loaded: 0,
      total: 0,
      indeterminate: false,
    });
  const byteProgress = new Map<string, ImportUploadProgress>();
  function reportBytes(key: string, progress: ImportUploadProgress): void {
    if (disposed) return;
    byteProgress.set(key, progress);
    const parts = [...byteProgress.values()];
    setUploadProgress({
      loaded: parts.reduce((sum, part) => sum + part.loaded, 0),
      total: parts.reduce((sum, part) => sum + part.total, 0),
      indeterminate: parts.some((part) => part.indeterminate),
    });
  }
  const abort = new AbortController();
  let disposed = false;
  let releaseFile: (() => void) | undefined;
  let localWork: Promise<void> | undefined;
  let request: CreateImport | undefined;
  let durableJob: ImportJob | undefined;
  let commandBusy = false;
  let cleanup: Promise<void> | undefined;
  const uploads = new Map<string, { signature: string; done: Promise<void> }>();
  const sealed = new Map<string, { signature: string; done: Promise<void> }>();

  function checkActive(): void {
    if (disposed || abort.signal.aborted) throw new Error('Import interrupted');
  }

  function accept(job: ImportJob): void {
    if (!durableJob || job.revision >= durableJob.revision) {
      durableJob = job;
      if (!disposed) setReceipt(job);
    }
  }

  const job = createMemo<ImportJob | undefined>((previous) => {
    const observed = source.job();
    const saved = receipt();
    const latest =
      observed &&
      saved &&
      observed.teamId === saved.teamId &&
      observed.jobId === saved.jobId &&
      observed.revision >= saved.revision
        ? observed
        : saved;
    if (!latest) return previous;
    if (previous && previous.revision > latest.revision) return previous;
    // Defense in depth: skip receipts must never expose an inaccessible target identity.
    return {
      ...latest,
      conversations: latest.conversations.map((conversation) => ({
        ...conversation,
        channelId:
          conversation.status === 'skipped'
            ? undefined
            : conversation.channelId,
      })),
    };
  });

  function scope(): { teamId: string; jobId: string } {
    if (!durableJob) throw new Error('No import job');
    return { teamId: options.teamId, jobId: durableJob.jobId };
  }

  function releaseProtection(): void {
    releaseFile?.();
    releaseFile = undefined;
  }

  async function releaseLocal(): Promise<void> {
    releaseProtection();
    cleanup ??= archive.dispose();
    try {
      await cleanup;
    } catch {
      if (!disposed)
        setWarning('Temporary archive storage could not be removed.');
    }
  }

  async function ensureJob(): Promise<void> {
    if (durableJob) return;
    if (!request) throw new Error('No import request');
    for (let attempt = 0; ; attempt++) {
      try {
        // Even after cancellation, recover a delayed write so cancel can address it.
        accept(await commands.create(options.teamId, structuredClone(request)));
        break;
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
    if (disposed) return;
    try {
      await options.onJobCreated?.(durableJob!);
    } catch {
      if (!disposed)
        setWarning('Import created; progress tracking could not be started.');
    }
  }

  async function uploadPart(
    descriptor: ImportUploadDescriptor,
    blob: Blob
  ): Promise<void> {
    const key = descriptorKey(descriptor);
    const total = descriptor.byteLength;
    for (let attempt = 0; ; attempt++) {
      checkActive();
      reportBytes(key, { loaded: 0, total, indeterminate: false });
      try {
        // Register one immutable descriptor only when a PUT slot is available.
        const grants = await commands.register(scope(), [
          structuredClone(descriptor),
        ]);
        checkActive();
        const grant = grants[0];
        if (
          grants.length !== 1 ||
          !grant ||
          descriptorSignature(grant.descriptor) !==
            descriptorSignature(descriptor)
        )
          throw new ImportUploadError('INVALID_GRANT');
        try {
          await grant.put(blob, {
            signal: abort.signal,
            onProgress: (progress) =>
              reportBytes(key, {
                loaded:
                  progress.kind === 'bytes'
                    ? Math.min(progress.loaded, total)
                    : 0,
                total,
                indeterminate: progress.kind === 'indeterminate',
              }),
          });
        } catch (putError) {
          checkActive();
          // A lost PUT response may still have committed the immutable object.
          // Completion performs server-side HEAD/checksum validation, including 412 retries.
          try {
            const verified = await commands.complete(scope(), [
              descriptor.upload,
            ]);
            checkActive();
            accept(verified);
            reportBytes(key, { loaded: total, total, indeterminate: false });
            return;
          } catch {
            throw putError;
          }
        }
        checkActive();
        const verified = await commands.complete(scope(), [descriptor.upload]);
        checkActive();
        accept(verified);
        reportBytes(key, { loaded: total, total, indeterminate: false });
        return;
      } catch (failure) {
        checkActive();
        if (
          attempt === 2 ||
          (failure instanceof ImportUploadError &&
            ['SIZE_MISMATCH', 'INVALID_GRANT', 'ABORTED'].includes(
              failure.code
            ))
        )
          throw failure;
      }
    }
  }

  function consumePart(
    descriptor: ImportUploadDescriptor,
    blob: Blob
  ): Promise<void> {
    checkActive();
    const snapshot = structuredClone(descriptor);
    const key = descriptorKey(snapshot);
    const signature = descriptorSignature(snapshot);
    const previous = uploads.get(key);
    if (previous) {
      if (signature !== previous.signature)
        throw new Error('Descriptor changed');
      return previous.done;
    }
    if (snapshot.upload.kind === 'conversation_part') {
      const id = snapshot.upload.slackChannelId;
      if (
        !request?.conversations.some(
          (conversation) => conversation.slackChannelId === id
        ) ||
        sealed.has(id)
      )
        throw new Error('Unexpected part');
    }
    setStage('uploading');
    const done = uploadPart(snapshot, blob);
    uploads.set(key, { signature, done });
    return done;
  }

  function consumeSeal(seal: ConversationSeal): Promise<void> {
    checkActive();
    const snapshot = { ...seal };
    const id = snapshot.slackChannelId;
    const signature = `${id}:${snapshot.partCount}:${snapshot.manifestSha256}`;
    const previous = sealed.get(id);
    if (previous) {
      if (signature !== previous.signature) throw new Error('Seal changed');
      return previous.done;
    }
    if (
      !request?.conversations.some(
        (conversation) => conversation.slackChannelId === id
      ) ||
      !Number.isSafeInteger(snapshot.partCount) ||
      snapshot.partCount < 0
    )
      throw new Error('Unexpected seal');
    const parts = [...uploads.keys()].filter((key) => key.startsWith(`${id}:`));
    if (parts.length !== snapshot.partCount)
      throw new Error('Incomplete manifest');
    const pending: Promise<void>[] = [];
    for (let index = 0; index < snapshot.partCount; index++) {
      const part = uploads.get(`${id}:${index}`);
      if (!part) throw new Error('Noncontiguous manifest');
      pending.push(part.done);
    }
    async function sealConversation(): Promise<void> {
      await Promise.all(pending);
      checkActive();
      const result = await commands.complete(scope(), [], snapshot);
      checkActive();
      accept(result);
    }
    const done = sealConversation();
    sealed.set(id, { signature, done });
    return done;
  }

  async function finalize(): Promise<void> {
    setStage('finalizing');
    const result = await commands.finalize(scope());
    accept(result);
    if (disposed || stage() === 'cancelling') return;
    setStage('monitoring');
    try {
      await options.onFinalized?.(result);
    } catch {
      if (!disposed)
        setWarning('Import saved; the display could not be refreshed.');
    }
  }

  async function runImport(users: ArchiveDiscovery['users']): Promise<void> {
    try {
      await ensureJob();
      checkActive();
      const limits = durableJob!.limits;
      const bytes = new TextEncoder().encode(JSON.stringify(users));
      if (bytes.byteLength > limits.jsonBytes)
        throw new Error('Users metadata exceeds the upload limit');
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      checkActive();
      const usersDescriptor: ImportUploadDescriptor = {
        upload: { kind: 'users' },
        byteLength: bytes.byteLength,
        sha256: Array.from(hash, (byte) =>
          byte.toString(16).padStart(2, '0')
        ).join(''),
      };
      // Attach both rejection handlers immediately; failure aborts the other lane.
      async function lane(work: () => Promise<void>): Promise<void> {
        try {
          await work();
        } catch (failure) {
          abort.abort();
          await releaseLocal();
          throw failure;
        }
      }
      const results = await Promise.allSettled([
        lane(() => consumePart(usersDescriptor, new Blob([bytes]))),
        lane(() =>
          archive.prepare({
            selectedIds: request!.conversations.map(
              (conversation) => conversation.slackChannelId
            ),
            includeMessageHistory: request!.includeMessageHistory,
            partLimits: limits,
            part: (descriptor: PartDescriptor, blob: Blob) =>
              consumePart(descriptor, blob),
            seal: consumeSeal,
          })
        ),
      ]);
      if (results.some((result) => result.status === 'rejected'))
        throw new Error('Local upload interrupted');
      checkActive();
      if (sealed.size !== request!.conversations.length)
        throw new Error('Missing conversation seal');
      await Promise.all([...sealed.values()].map((seal) => seal.done));
      await releaseLocal();
      checkActive();
      await finalize();
    } catch {
      if (!disposed && stage() !== 'cancelling') {
        setError(
          'Import interrupted. Recover the job if necessary, then explicitly finalize with skips or cancel.'
        );
        setStage('interrupted');
      }
    } finally {
      await releaseLocal();
    }
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    abort.abort();
    setStage('disposed');
    await releaseLocal();
  }
  onCleanup(() => {
    void dispose();
  });

  return {
    phase: () => {
      const current = job();
      if (stage() === 'monitoring' && current && terminal(current))
        return 'terminal';
      return stage();
    },
    discovery,
    uploadProgress,
    job,
    jobId: () => receipt()?.jobId,
    error,
    warning: () =>
      warning() ??
      (source.error()
        ? 'Progress could not be refreshed. The server import may still be running.'
        : undefined),
    skips: () => {
      const found = discovery();
      const skips = new Map<string, ImportSkip>();
      if (found && !request)
        for (const slackChannelId of unsupportedDirectMessages(found))
          skips.set(slackChannelId, {
            slackChannelId,
            reason: 'unsupported_dm',
          });
      for (const conversation of job()?.conversations ?? []) {
        if (conversation.status !== 'skipped') continue;
        let reason: ImportSkip['reason'] = 'skipped';
        if (
          conversation.warnings.includes('target_unavailable') ||
          conversation.error === 'unavailable'
        )
          reason = 'target_unavailable';
        else if (conversation.warnings.includes('unresolvable_direct_message'))
          reason = 'unsupported_dm';
        else if (conversation.warnings.includes('uploads_incomplete'))
          reason = 'uploads_incomplete';
        skips.set(conversation.slackChannelId, {
          slackChannelId: conversation.slackChannelId,
          reason,
        });
      }
      return [...skips.values()];
    },
    async discover(file) {
      if (stage() !== 'idle') return;
      setStage('discovering');
      async function discoverArchive(): Promise<void> {
        try {
          releaseFile = options.protectFile();
          const found = await archive.discover(file, options.limits);
          checkActive();
          setDiscovery(found);
          setStage('selecting');
        } catch {
          if (!disposed && stage() !== 'cancelling') {
            setError('The archive could not be read. Choose a new file.');
            setStage('interrupted');
          }
          await releaseLocal();
        } finally {
          releaseProtection();
        }
      }
      localWork = discoverArchive();
      await localWork;
    },
    async start(selection) {
      if (stage() !== 'selecting') return;
      const found = discovery()!;
      const binding = options.sourceBinding();
      if (!selection.sourceConfirmed)
        throw new Error('Confirm the Slack source binding before importing.');
      if (
        found.source.kind === 'known' &&
        binding.kind === 'known' &&
        found.source.sourceId !== binding.sourceId
      )
        throw new Error('The archive belongs to a different Slack workspace.');
      const ids = new Set(selection.selectedIds);
      const unsupported = unsupportedDirectMessages(found);
      if (
        !ids.size ||
        ids.size !== selection.selectedIds.length ||
        ids.size > options.limits.conversations ||
        [...ids].some(
          (id) =>
            !found.conversations.some(
              (conversation) => conversation.slackChannelId === id
            ) || unsupported.has(id)
        )
      )
        throw new Error(
          'Select supported conversations within the import limit.'
        );
      request = {
        idempotencyToken: options.newToken(),
        includeMessageHistory: selection.includeMessageHistory ?? true,
        source:
          found.source.kind === 'known'
            ? { ...found.source }
            : { kind: 'confirmed_unknown' },
        conversations: structuredClone(
          found.conversations.filter((conversation) =>
            ids.has(conversation.slackChannelId)
          )
        ),
      };
      setStage('preparing');
      try {
        releaseFile = options.protectFile();
      } catch {
        setStage('interrupted');
        setError('The local file could not be protected.');
        await releaseLocal();
        return;
      }
      localWork = runImport(found.users);
      await localWork;
    },
    async recoverJob() {
      if (
        disposed ||
        commandBusy ||
        stage() !== 'interrupted' ||
        durableJob ||
        !request
      )
        return;
      commandBusy = true;
      try {
        await ensureJob();
      } catch {
        if (!disposed)
          setError(
            'The job receipt could not be recovered. Retry with the same import.'
          );
      } finally {
        commandBusy = false;
      }
    },
    async finalizeWithSkips() {
      if (disposed || commandBusy || stage() !== 'interrupted' || !durableJob)
        return;
      commandBusy = true;
      setError(undefined);
      try {
        await finalize();
      } catch {
        if (!disposed) {
          setStage('interrupted');
          setError('Finalization was not confirmed. Retry or cancel.');
        }
      } finally {
        commandBusy = false;
      }
    },
    async cancel() {
      if (disposed || commandBusy || stage() === 'terminal') return;
      commandBusy = true;
      setStage('cancelling');
      abort.abort();
      await releaseLocal();
      await localWork;
      try {
        if (request && !durableJob) await ensureJob();
        if (disposed) return;
        const current = job();
        if (durableJob && !(current && terminal(current)))
          accept(await commands.cancel(scope()));
        if (!disposed) {
          setError(undefined);
          setStage(durableJob ? 'monitoring' : 'terminal');
        }
      } catch {
        if (!disposed) {
          setStage('interrupted');
          setError('Cancellation was not confirmed. Retry cancel.');
        }
      } finally {
        commandBusy = false;
      }
    },
    async refresh() {
      if (disposed) return;
      try {
        await source.refresh();
      } catch {
        if (!disposed)
          setWarning(
            'Progress could not be refreshed. The server import may still be running.'
          );
      }
    },
    dispose,
  };
}

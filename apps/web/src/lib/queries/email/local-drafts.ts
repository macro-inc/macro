import type { SaveEmailDraft } from '@app/features/email-compose/context/compose-capabilities';
import type {
  DraftAttempt,
  LocalDraft,
  LocalDraftAttachment,
} from '@app/features/email-compose/core/local-draft';
import type { DraftFormAttachment } from '@app/features/email-compose/primitives/email-form-state';
import type { EmailMessage } from '@app/features/email-message/core/email-message';
import { getNativeStagedUpload } from '@core/mobile/nativeStagedUpload';
import type { NormalizedCacheExchangeOptions } from '@graphql-cache/exchange/normalized-cache-exchange';
import type { CacheHost } from '@graphql-cache/host/types';
import type {
  ClaimedMutation,
  MutationInspection,
} from '@graphql-cache/protocol';
import type { OperationResult } from '@urql/core';
import { authKeys } from '../auth/keys';
import type { UserInfoData } from '../auth/user-info';
import { queryClient } from '../client';
import { createLocalDraftStore } from './local-draft-store';

export const localDraftStore = createLocalDraftStore();
const fileIds = new WeakMap<File, string>();
const fileCopies = new WeakMap<File, Promise<Blob>>();
const pendingWrites = new Set<Promise<LocalDraft>>();
const EPOCH_KEY = 'email-working-copies:epoch';
let documentSession: { accountId: string; epoch: string } | undefined;
let retiredSession = false;

function storageEpoch() {
  let epoch = localStorage.getItem(EPOCH_KEY);
  if (!epoch) {
    epoch = crypto.randomUUID();
    localStorage.setItem(EPOCH_KEY, epoch);
  }
  return epoch;
}

export async function flushLocalDrafts(): Promise<void> {
  while (pendingWrites.size) await Promise.all([...pendingWrites]);
}

export async function clearLocalDrafts(): Promise<void> {
  // Quarantine before clearing so a failed disk wipe cannot expose old drafts.
  retiredSession = true;
  let quarantineError: unknown;
  let previousEpoch = documentSession?.epoch;
  try {
    previousEpoch ??= localStorage.getItem(EPOCH_KEY) ?? undefined;
    localStorage.setItem(EPOCH_KEY, crypto.randomUUID());
  } catch (error) {
    quarantineError = error;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      localDraftStore.clear(true, previousEpoch),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Clearing draft storage timed out')),
          2_000
        );
      }),
    ]);
  } catch (error) {
    if (quarantineError)
      throw new AggregateError(
        [quarantineError, error],
        'Unable to clear local drafts'
      );
  } finally {
    clearTimeout(timer);
  }
}

async function session() {
  const user = queryClient.getQueryData<UserInfoData>(
    authKeys.userInfo.queryKey
  );
  if (!user?.authenticated || !user.id)
    throw new Error('Sign in to save drafts on this device');
  const epoch = storageEpoch();
  if (
    retiredSession ||
    (documentSession &&
      (documentSession.accountId !== user.id ||
        documentSession.epoch !== epoch))
  ) {
    throw new Error(
      'This draft session is no longer active; reload to use the current account'
    );
  }
  documentSession ??= { accountId: user.id, epoch };
  const expected = documentSession;
  return await localDraftStore.activate(
    expected.accountId,
    expected.epoch,
    () => {
      const current = queryClient.getQueryData<UserInfoData>(
        authKeys.userInfo.queryKey
      );
      return (
        !retiredSession &&
        current?.authenticated === true &&
        current.id === expected.accountId &&
        localStorage.getItem(EPOCH_KEY) === expected.epoch
      );
    }
  );
}

export async function listLocalDrafts(): Promise<LocalDraft[]> {
  const owner = await session();
  return await localDraftStore.list(owner);
}
export async function readLocalDraft(
  id: string
): Promise<LocalDraft | undefined> {
  return await localDraftStore.read(await session(), id);
}

/** Local body HTML uses the same base64 representation as the editor's save input. */
export function localDraftMessage(local: LocalDraft): EmailMessage {
  const content = local.content;
  const time = new Date(local.updatedAt).toISOString();
  return {
    ...content,
    db_id: local.serverDraftId ?? local.draftId,
    thread_db_id: local.serverThreadId ?? local.threadId ?? local.draftId,
    link_id: local.inboxId ?? '',
    is_draft: true,
    created_at: time,
    updated_at: time,
    body_html_sanitized: content.body_html,
    to: content.to ?? [],
    cc: content.cc ?? [],
    bcc: content.bcc ?? [],
    from: { email: local.senderEmail ?? '' },
    labels: [],
    attachments: [],
    attachments_draft: local.attachments.flatMap((attachment) =>
      attachment.type === 'remote'
        ? [
            {
              id: attachment.attachmentId,
              file_name: attachment.fileName,
              content_type: attachment.contentType,
              size: attachment.fileSize,
              s3_key: '',
            },
          ]
        : []
    ),
    attachments_forwarded: local.attachments.flatMap((attachment) =>
      attachment.type === 'forwarded'
        ? [
            {
              attachment_id: attachment.attachmentId,
              filename: attachment.fileName,
              mime_type: attachment.mimeType,
              size_bytes: attachment.fileSize,
            },
          ]
        : []
    ),
  };
}

async function copyFile(file: File): Promise<Blob> {
  let pending = fileCopies.get(file);
  if (!pending) {
    pending = (async () => {
      const staged = getNativeStagedUpload(file);
      if (!staged) return file;
      if (!staged.previewSrc)
        throw new Error('Attachment bytes are unavailable on this device');
      const response = await fetch(staged.previewSrc);
      if (!response.ok)
        throw new Error('Unable to preserve attachment on this device');
      const blob = await response.blob();
      if (blob.size !== staged.size)
        throw new Error('Attachment size mismatch');
      return blob;
    })();
    fileCopies.set(file, pending);
  }
  try {
    return await pending;
  } catch (error) {
    fileCopies.delete(file);
    throw error;
  }
}

export type LocalDraftInput = SaveEmailDraft & {
  expectedRevision?: number;
  expectedGeneration?: string;
  attachments: readonly DraftFormAttachment[];
  senderEmail?: string;
};

/** Called on every edit, including edits made while server autosave is paused. */
export function saveLocalDraft(input: LocalDraftInput): Promise<LocalDraft> {
  const write = persistLocalDraft(input);
  pendingWrites.add(write);
  void finishLocalWrite(write);
  return write;
}

async function finishLocalWrite(write: Promise<LocalDraft>): Promise<void> {
  try {
    await write;
  } catch {
    /* The caller reports the original write failure. */
  } finally {
    pendingWrites.delete(write);
  }
}

async function persistLocalDraft(input: LocalDraftInput): Promise<LocalDraft> {
  const owner = await session();
  const id = input.clientHandles?.draftId ?? input.draft.db_id;
  if (!id)
    throw new Error('Draft identity must be minted before local persistence');
  const previous = await localDraftStore.read(owner, id);
  const key = previous?.key ?? id;
  const files = new Map<string, Blob>();
  const attachments: LocalDraftAttachment[] = [];
  for (const attachment of input.attachments) {
    // Document attachments exist only in the AI draft composer, which keeps no
    // local draft.
    if (attachment.type === 'document') continue;
    if (attachment.type !== 'local') {
      attachments.push({ ...attachment });
      continue;
    }
    let fileId = fileIds.get(attachment.file);
    if (!fileId) {
      fileId = crypto.randomUUID();
      fileIds.set(attachment.file, fileId);
    }
    const blob = await copyFile(attachment.file);
    files.set(fileId, blob);
    const old = previous?.attachments.find(
      (entry) => entry.type === 'local' && entry.id === fileId
    );
    attachments.push({
      type: 'local',
      id: fileId,
      name: attachment.file.name,
      mimeType: blob.type || attachment.file.type,
      size: blob.size,
      lastModified: attachment.file.lastModified,
      attachmentId: attachment.attachmentId,
      uploaded:
        !!attachment.attachmentId &&
        (attachment.uploaded === true ||
          (old?.type === 'local' &&
            old.attachmentId === attachment.attachmentId &&
            old.uploaded)),
    });
  }
  return await localDraftStore.save(
    owner,
    {
      key,
      expectedRevision: input.expectedRevision ?? previous?.revision ?? 0,
      accountId: owner.accountId,
      generation:
        input.expectedGeneration ??
        previous?.generation ??
        (await localDraftStore.generation(owner, key)),
      draftId: previous?.draftId ?? id,
      threadId:
        previous?.threadId ??
        input.clientHandles?.threadId ??
        input.draft.thread_db_id ??
        undefined,
      serverDraftId:
        previous?.serverDraftId ??
        (input.clientHandles ? undefined : (input.draft.db_id ?? undefined)),
      serverThreadId: previous?.serverThreadId,
      inboxId: input.inboxId,
      senderEmail: input.senderEmail,
      content: structuredClone({
        ...input.draft,
        replying_to_id:
          input.draft.replying_to_id ?? previous?.content.replying_to_id,
        provider_id: input.draft.provider_id ?? previous?.content.provider_id,
        provider_thread_id:
          input.draft.provider_thread_id ??
          previous?.content.provider_thread_id,
        thread_db_id:
          input.draft.thread_db_id ?? previous?.content.thread_db_id,
      }),
      attachments,
      status: 'dirty',
    },
    files
  );
}

export async function restoreLocalAttachments(
  local: LocalDraft
): Promise<DraftFormAttachment[]> {
  const owner = await session();
  const attachments: DraftFormAttachment[] = [];
  for (const attachment of local.attachments) {
    if (attachment.type !== 'local') {
      attachments.push(attachment);
      continue;
    }
    const blob = await localDraftStore.file(owner, local.key, attachment.id);
    if (!blob)
      throw new Error(
        `The locally saved attachment ${attachment.name} is unavailable`
      );
    const file = new File([blob], attachment.name, {
      type: attachment.mimeType,
      lastModified: attachment.lastModified,
    });
    fileIds.set(file, attachment.id);
    attachments.push({
      type: 'local',
      file,
      attachmentId: attachment.attachmentId,
      uploaded: attachment.uploaded,
      uploadPending: !attachment.uploaded && !!attachment.attachmentId,
    });
  }
  return attachments;
}

export function draftSyncPaused(local: LocalDraft): boolean {
  return (
    local.status === 'failed' ||
    local.status === 'unconfirmed' ||
    local.status === 'delete-failed'
  );
}

export async function resumeLocalDraft(id: string): Promise<void> {
  const owner = await session();
  const draft = await localDraftStore.read(owner, id);
  if (!draft) return;
  await localDraftStore.update(owner, draft.key, (current) => ({
    ...current,
    status: 'dirty',
    errorCode: undefined,
    latestAttemptId: undefined,
    queuedAttemptId: undefined,
  }));
}

export async function forgetLocalDraft(id: string): Promise<void> {
  const owner = await session();
  const draft = await localDraftStore.read(owner, id);
  if (draft) await localDraftStore.update(owner, draft.key, () => undefined);
}

/** Only an explicit server Undo may start a fresh lifetime for a retired handle. */
export async function reviveLocalDraft(id: string): Promise<void> {
  const owner = await session();
  await localDraftStore.generation(owner, id, true);
}

export async function clearLocalAttachmentReceipt(
  draftId: string,
  attachmentId: string
): Promise<void> {
  const owner = await session();
  const draft = await localDraftStore.read(owner, draftId);
  if (!draft) return;
  await localDraftStore.update(owner, draft.key, (current) => ({
    ...current,
    attachments: current.attachments.map((attachment) =>
      attachment.type === 'local' && attachment.attachmentId === attachmentId
        ? { ...attachment, attachmentId: undefined, uploaded: false }
        : attachment
    ),
  }));
}

/** A record ID is not an upload receipt; persist both stages independently. */
export async function recordLocalAttachment(
  draftId: string,
  file: File,
  attachmentId: string | undefined,
  uploaded: boolean
): Promise<void> {
  const owner = await session();
  const draft = await localDraftStore.read(owner, draftId);
  const id = fileIds.get(file);
  if (!draft || !id) return;
  await localDraftStore.update(owner, draft.key, (current) => {
    if (current.generation !== draft.generation) return current;
    const attachments = current.attachments.map((attachment) =>
      attachment.type === 'local' && attachment.id === id
        ? { ...attachment, attachmentId, uploaded }
        : attachment
    );
    return {
      ...current,
      attachments,
      status:
        !draftSyncPaused(current) &&
        current.status !== 'deleting' &&
        current.acknowledgedRevision === current.revision &&
        !attachments.some(
          (attachment) => attachment.type === 'local' && !attachment.uploaded
        )
          ? 'synced'
          : current.status,
    };
  });
}

export async function beginDraftAttempt(
  local: LocalDraft,
  operation: 'save' | 'delete'
): Promise<DraftAttempt> {
  const owner = await session();
  if (local.accountId !== owner.accountId)
    throw new Error('This draft belongs to a previous account');
  const attempt: DraftAttempt = {
    kind: 'email-draft',
    id: crypto.randomUUID(),
    draftKey: local.key,
    accountId: owner.accountId,
    generation: local.generation,
    revision: local.revision,
    operation,
  };
  await localDraftStore.update(owner, local.key, (current) =>
    current.generation !== local.generation ||
    (operation === 'save' &&
      (current.revision !== local.revision ||
        draftSyncPaused(current) ||
        current.status === 'deleting'))
      ? current
      : {
          ...current,
          latestAttemptId: attempt.id,
          queuedAttemptId: undefined,
          status: operation === 'delete' ? 'deleting' : 'dirty',
        }
  );
  return attempt;
}

/** Admission is separate from intent: two stores cannot enqueue atomically. */
export async function markDraftAttemptQueued(
  attempt: DraftAttempt
): Promise<void> {
  const owner = await session();
  if (owner.accountId !== attempt.accountId) return;
  await localDraftStore.update(owner, attempt.draftKey, (draft) =>
    draft.generation !== attempt.generation ||
    draft.latestAttemptId !== attempt.id ||
    draftSyncPaused(draft) ||
    draft.status === 'synced'
      ? draft
      : {
          ...draft,
          queuedAttemptId: attempt.id,
          status:
            attempt.operation === 'delete'
              ? 'deleting'
              : draft.revision === attempt.revision
                ? 'queued'
                : draft.status,
        }
  );
}

function attemptOf(
  mutation: Pick<ClaimedMutation, 'clientMetadata'>
): DraftAttempt | undefined {
  const value = mutation.clientMetadata;
  if (
    !value ||
    value.kind !== 'email-draft' ||
    typeof value.id !== 'string' ||
    typeof value.draftKey !== 'string' ||
    typeof value.accountId !== 'string' ||
    typeof value.generation !== 'string' ||
    typeof value.revision !== 'number' ||
    (value.operation !== 'save' && value.operation !== 'delete')
  )
    return;
  return value as DraftAttempt;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}
function objects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(object) : [];
}
function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Replay bookkeeping runs even when no composer is mounted. */
export function localDraftQueueLifecycle(
  host: CacheHost
): Pick<
  NormalizedCacheExchangeOptions,
  'prepareMutationQueue' | 'beforeMutationAttempt' | 'onMutationAttemptResult'
> {
  let initialized: Promise<void> | undefined;
  const legacy = new Map<string, DraftAttempt>();
  const migrated = new Map<string, number>();
  async function preserveLegacy(
    mutation: MutationInspection
  ): Promise<DraftAttempt | undefined> {
    if (
      mutation.operationName !== 'SaveEmailDraft' &&
      mutation.operationName !== 'DeleteEmailDraft'
    )
      return;
    const known = legacy.get(mutation.transactionId);
    if (known) return known;
    const owner = await session();
    const storageGeneration = await host.currentStorageGeneration();
    const saved = (await localDraftStore.attempts(owner)).find(
      (entry) =>
        entry.transactionId === mutation.transactionId &&
        entry.storageGeneration === storageGeneration
    );
    if (saved) {
      const previous = await localDraftStore.read(owner, saved.draftKey);
      const previousId = text(object(mutation.variables.input).draftId);
      if (previous && previousId && previous.revision === saved.revision)
        migrated.set(previousId, previous.revision);
      legacy.set(mutation.transactionId, saved);
      return saved;
    }
    const input = object(mutation.variables.input);
    const id = text(input.draftId);
    if (!id) throw new Error('Queued email draft has no recoverable identity');
    let draft = await localDraftStore.read(owner, id);
    let revision = 0;
    if (
      mutation.operationName === 'SaveEmailDraft' &&
      (!draft || migrated.get(id) === draft.revision)
    ) {
      const optimistic = object(object(mutation.optimisticData).saveEmailDraft);
      const message = object(optimistic.draft);
      const attachments: LocalDraftAttachment[] = [
        ...objects(message.attachmentsDraft).map(
          (attachment): LocalDraftAttachment => ({
            type: 'remote',
            attachmentId: String(attachment.id),
            fileName: String(attachment.fileName ?? ''),
            contentType: String(attachment.contentType ?? ''),
            fileSize: Number(attachment.size ?? 0),
            url: String(attachment.s3Key ?? ''),
          })
        ),
        ...objects(message.attachmentsForwarded).map(
          (attachment): LocalDraftAttachment => ({
            type: 'forwarded',
            attachmentId: String(attachment.attachmentId),
            fileName: String(attachment.filename ?? ''),
            mimeType: String(attachment.mimeType ?? ''),
            fileSize: Number(attachment.sizeBytes ?? 0),
          })
        ),
      ];
      const contacts = (value: unknown) =>
        objects(value).map((entry) => ({
          email: String(entry.email ?? ''),
          name: text(entry.name),
          photo_url: text(entry.photoUrl),
        }));
      draft = await localDraftStore.save(owner, {
        expectedRevision: draft?.revision ?? 0,
        key: draft?.key ?? id,
        accountId: owner.accountId,
        generation: draft?.generation ?? crypto.randomUUID(),
        draftId: draft?.draftId ?? id,
        threadId: text(input.threadDbId),
        inboxId: text(input.linkId) ?? text(message.linkId),
        senderEmail: text(object(message.from).email),
        content: {
          subject: String(input.subject ?? ''),
          body_html: text(input.bodyHtml),
          body_text: text(input.bodyText),
          body_macro: text(input.bodyMacro),
          replying_to_id: text(input.replyingToId),
          provider_id: text(input.providerId),
          provider_thread_id: text(input.providerThreadId),
          to: contacts(input.to),
          cc: contacts(input.cc),
          bcc: contacts(input.bcc),
        },
        attachments,
        status: 'queued',
      });
      migrated.set(id, draft.revision);
      revision = draft.revision;
    }
    if (!draft) return;
    const attempt: DraftAttempt = {
      kind: 'email-draft',
      id: crypto.randomUUID(),
      draftKey: draft.key,
      accountId: owner.accountId,
      generation: draft.generation,
      revision,
      operation:
        mutation.operationName === 'DeleteEmailDraft' ? 'delete' : 'save',
    };
    // The mapping is only for queue records written by an older app version.
    await localDraftStore.recordAttempt(owner, {
      ...attempt,
      transactionId: mutation.transactionId,
      storageGeneration,
    });
    if (revision || !draft.latestAttemptId)
      await localDraftStore.update(owner, draft.key, (current) =>
        current.revision !== draft.revision
          ? current
          : {
              ...current,
              latestAttemptId: attempt.id,
              queuedAttemptId: attempt.id,
              status: attempt.operation === 'delete' ? 'deleting' : 'queued',
            }
      );
    legacy.set(mutation.transactionId, attempt);
    return attempt;
  }
  async function prepare() {
    const owner = await session();
    if (!host.inspectMutations)
      throw new Error('Draft recovery requires an updated cache runtime');
    const before = await localDraftStore.list(owner);
    const queue = await host.inspectMutations();
    const storageGeneration = await host.currentStorageGeneration();
    for (const mutation of queue)
      if (!attemptOf(mutation)) await preserveLegacy(mutation);
    const active = new Set(
      queue.map(
        (mutation) =>
          (attemptOf(mutation) ?? legacy.get(mutation.transactionId))?.draftKey
      )
    );
    for (const draft of before) {
      // Dirty copies can belong to another tab's live debounce. Only reconcile
      // an unchanged intent that was actually marked as enqueued/deleting.
      if (
        active.has(draft.key) ||
        draft.queuedAttemptId !== draft.latestAttemptId ||
        !draft.queuedAttemptId ||
        (draft.status !== 'queued' && draft.status !== 'deleting')
      )
        continue;
      await localDraftStore.update(owner, draft.key, (current) =>
        current.generation === draft.generation &&
        current.revision === draft.revision &&
        current.latestAttemptId === draft.latestAttemptId &&
        current.status === draft.status
          ? {
              ...current,
              status:
                current.status === 'deleting' ? 'delete-failed' : 'unconfirmed',
            }
          : current
      );
    }
    const transactions = new Set(
      queue.map((mutation) => mutation.transactionId)
    );
    for (const attempt of await localDraftStore.attempts(owner)) {
      if (
        attempt.storageGeneration !== storageGeneration ||
        !transactions.has(attempt.transactionId)
      )
        await localDraftStore.removeAttempt(
          owner,
          attempt.storageGeneration,
          attempt.transactionId
        );
    }
  }
  async function resolveAttempt(mutation: ClaimedMutation) {
    const current = attemptOf(mutation) ?? legacy.get(mutation.transactionId);
    if (
      current ||
      (mutation.operationName !== 'SaveEmailDraft' &&
        mutation.operationName !== 'DeleteEmailDraft')
    )
      return current;
    if (!host.inspectMutations)
      throw new Error('Cannot preserve queued email draft');
    const queued = (await host.inspectMutations()).find(
      (entry) => entry.transactionId === mutation.transactionId
    );
    if (!queued)
      throw new Error('Queued email draft disappeared before recovery');
    return await preserveLegacy(queued);
  }
  return {
    async prepareMutationQueue() {
      try {
        initialized ??= prepare();
        await initialized;
      } catch (error) {
        initialized = undefined;
        throw error;
      }
    },
    async beforeMutationAttempt(mutation) {
      const attempt = await resolveAttempt(mutation);
      if (!attempt) return true;
      const owner = await session();
      if (owner.accountId !== attempt.accountId) return false;
      const local = await localDraftStore.read(owner, attempt.draftKey);
      if (!local || local.generation !== attempt.generation) return false;
      await markDraftAttemptQueued(attempt);
      return attempt.operation === 'delete'
        ? local.latestAttemptId === attempt.id && local.status === 'deleting'
        : !draftSyncPaused(local) &&
            local.status !== 'deleting' &&
            attempt.revision >= local.acknowledgedRevision;
    },
    async onMutationAttemptResult(mutation, result, retry) {
      if (
        result.error?.graphQLErrors.some(
          (error) => error.extensions.code === 'LOCAL_RECOVERY_FAILED'
        )
      )
        initialized = undefined;
      const attempt = attemptOf(mutation) ?? legacy.get(mutation.transactionId);
      if (!attempt || retry) return;
      await settleDraftAttempt(attempt, result, mutation.superseded);
    },
  };
}

async function settleDraftAttempt(
  attempt: DraftAttempt,
  result: OperationResult,
  superseded: boolean
) {
  const owner = await session();
  if (owner.accountId !== attempt.accountId) return;
  const code = result.error?.graphQLErrors[0]?.extensions.code;
  const failed = !!result.error || result.data == null;
  const payload = result.data?.saveEmailDraft;
  await localDraftStore.update(owner, attempt.draftKey, (draft) => {
    if (draft.generation !== attempt.generation) return draft;
    if (code === 'DRAFT_ALREADY_SENT') return undefined;
    const latest = draft.latestAttemptId === attempt.id;
    if (attempt.operation === 'delete') {
      if (!latest) return draft;
      return failed
        ? {
            ...draft,
            status: 'delete-failed',
            errorCode: typeof code === 'string' ? code : 'INTERNAL',
          }
        : undefined;
    }
    if (failed)
      return superseded || !latest
        ? draft
        : {
            ...draft,
            status: 'failed',
            errorCode: typeof code === 'string' ? code : 'INTERNAL',
          };
    const acknowledgedRevision = Math.max(
      draft.acknowledgedRevision,
      attempt.revision
    );
    return {
      ...draft,
      acknowledgedRevision,
      serverDraftId: payload?.draftId ?? draft.serverDraftId,
      serverThreadId: payload?.thread?.id ?? draft.serverThreadId,
      status:
        latest && !draftSyncPaused(draft) && draft.status !== 'deleting'
          ? draft.revision !== attempt.revision ||
            draft.attachments.some(
              (attachment) =>
                attachment.type === 'local' && !attachment.uploaded
            )
            ? 'dirty'
            : 'synced'
          : draft.status,
    };
  });
}

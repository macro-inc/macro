import { toast } from '@core/component/Toast/Toast';
import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import {
  readRecordsByKeys,
  selectRecords,
} from '@graphql-cache/exchange/record-selection';
import { Telemetry } from '@macro-inc/observability';
import {
  EmailDraftThreadFieldsFragmentDoc,
  EmailThreadMessageFieldsFragmentDoc,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlCacheHost,
  getGraphqlSoupClient,
  graphqlCacheEnabled,
} from '@service-storage/graphql-soup';
import { queryClient } from '../client';
import {
  invalidateAllSoup,
  invalidateSoupEntity,
  refetchSoupEntity,
} from '../soup/cache';
import { markThreadDraftSaved } from './draft-cache';
import {
  draftFailureCode,
  executeGraphqlDeleteEmailDraft,
  executeGraphqlSaveEmailDraft,
  type GraphqlSaveEmailDraftArgs,
  type SaveEmailDraftFailureCode,
} from './graphql/draft';
import { mapGraphqlEmailMessage } from './graphql/mapper';
import { emailKeys } from './keys';
import {
  beginDraftAttempt,
  draftSyncPaused,
  localDraftMessage,
  localDraftStore,
  markDraftAttemptQueued,
  readLocalDraft,
  restoreLocalAttachments,
} from './local-drafts';
import { fetchAndCacheThread, type ThreadQueryTransport } from './thread';

/** Read content and persistence state together, including resolved local handles. */
export async function readEmailDraft(
  draftId: string,
  options: { attachments?: boolean } = {}
) {
  const local = await readLocalDraft(draftId);
  const host = getGraphqlCacheHost();
  const result = host
    ? await readRecordsByKeys(
        host,
        selectRecords(EmailThreadMessageFieldsFragmentDoc),
        [`GraphqlSoupEmailMessage:${local?.serverDraftId ?? draftId}`]
      )
    : undefined;
  const selected = result?.records[0];
  // A confirmed sent record always wins. A fully synced working copy must
  // also yield to newer server content, attachments, and scheduling state.
  if (
    selected &&
    (!selected.record.isDraft || !local || local.status === 'synced')
  ) {
    return {
      draft: selected.record.isDraft
        ? mapGraphqlEmailMessage(selected.record)
        : undefined,
      persistence: selected.identity?.pending
        ? ('queued' as const)
        : ('committed' as const),
      mutationUuid: local?.key ?? selected.identity?.mutationUuid ?? undefined,
      local: selected.record.isDraft ? local : undefined,
    };
  }
  const admittedDelete =
    local?.status === 'deleting' &&
    !!local.queuedAttemptId &&
    local.queuedAttemptId === local.latestAttemptId;
  if (local && (!admittedDelete || options.attachments === false)) {
    return {
      draft: localDraftMessage(local),
      // Upload receipts are separate from the body save. Pending files must
      // not demote an acknowledged server identity to a client handle.
      persistence:
        local.serverDraftId && local.acknowledgedRevision >= local.revision
          ? ('committed' as const)
          : ('queued' as const),
      mutationUuid: local.key,
      local,
      attachments:
        options.attachments === false
          ? undefined
          : await restoreLocalAttachments(local),
    };
  }
  if (!selected) return;
  return {
    draft: selected.record.isDraft
      ? mapGraphqlEmailMessage(selected.record)
      : undefined,
    persistence: selected.identity?.pending
      ? ('queued' as const)
      : ('committed' as const),
    mutationUuid: selected.identity?.mutationUuid ?? undefined,
  };
}

/** Subscribers read durable state; missing a notification is harmless on remount. */
export function watchEmailDrafts(
  changed: (settlement?: {
    mutationUuid?: string;
    failed: boolean;
    code?: DraftWriteRejection;
  }) => void
): () => void {
  // A surface can enable the queue after mounting, before its first write
  // initializes the client. Subscribe to that host before any save settles.
  getGraphqlSoupClient();
  const host = getGraphqlCacheHost();
  const cache = host?.onCacheChanged(() => changed());
  const local = localDraftStore.subscribe(() => changed());
  const settlement = host?.onMutationSettled((result) => {
    if (
      result.status === 'permanently-failed' &&
      result.errorCode === 'LOCAL_SUPERSEDED'
    ) {
      changed();
      return;
    }
    const code =
      result.status === 'permanently-failed'
        ? draftFailureCode(result.errorCode)
        : undefined;
    changed({
      mutationUuid: result.mutationUuid,
      failed: result.status === 'permanently-failed',
      code,
    });
  });
  return () => {
    local();
    cache?.();
    settlement?.();
  };
}

/**
 * Whether a surface's draft writes ride the durable GraphQL mutation queue,
 * where offline writes persist locally and replay as idempotent upserts
 * keyed by client handles.
 *
 * A write must use the transport the surface's thread read used: a queued
 * save against a REST-read thread has no cached page for its optimistic
 * patch, so the draft would be durable but invisible offline. Replies follow
 * their thread query's transport; a surface without one follows the soup
 * flag. The uncached fallback client has no queue, so REST remains the
 * fallback there.
 */
export function draftQueueActive(
  threadTransport?: ThreadQueryTransport
): boolean {
  if (!graphqlCacheEnabled()) return false;
  return threadTransport
    ? threadTransport === 'graphql'
    : isFeatureEnabled(enableGraphqlSoup);
}

/** A server rejection of a draft write; autosave never retries these. */
export type DraftWriteRejection = Exclude<SaveEmailDraftFailureCode, 'NETWORK'>;

export type QueuedDraftSave =
  | { kind: 'committed'; draftId: string; threadId: string }
  /** Durably accepted under the caller's handles; the server may not know them yet. */
  | { kind: 'queued' }
  | { kind: 'rejected'; code: DraftWriteRejection };

export type QueuedDraftDelete =
  | { kind: 'committed' | 'queued' }
  | { kind: 'rejected'; code: DraftWriteRejection };

const reportError = (error: unknown) =>
  Telemetry.error(error instanceof Error ? error : new Error(String(error)));

/**
 * Notices and cache repair for a failed write, matching the REST mutations'
 * onError. A transport failure throws — the write was never enqueued and the
 * next save may retry it. A draft sent from another device gets its thread
 * refreshed; the caller drops the local draft.
 */
function rejection(
  code: SaveEmailDraftFailureCode,
  message: string,
  threadId: string
): DraftWriteRejection {
  if (code === 'NETWORK') {
    toast.failure(message);
    throw new Error(`${message}: network`);
  }
  if (code === 'DRAFT_ALREADY_SENT') {
    markThreadDraftSaved(threadId);
    invalidateSoupEntity(threadId);
    void refetchSoupEntity(threadId, 'emailThread').catch(reportError);
    void fetchAndCacheThread(threadId);
  } else {
    toast.failure(message);
    reportError(new Error(`${message}: ${code}`));
  }
  return code;
}

const SNAPSHOT_READ_ATTEMPTS = 3;

/** The draft and thread records a queued write rebases onto, when cached. */
async function readCachedDraftAndThread(
  draftId: string,
  threadId: string
): Promise<
  Pick<
    GraphqlSaveEmailDraftArgs,
    | 'draftId'
    | 'threadDbId'
    | 'existingDraft'
    | 'existingThread'
    | 'mutationUuid'
  >
> {
  const host = getGraphqlCacheHost();
  if (!host) return { draftId, threadDbId: threadId };
  // Settlement can land between these reads. Compose from one revision so a
  // local draft is never combined with a thread already using its server ID.
  for (let attempt = 0; attempt < SNAPSHOT_READ_ATTEMPTS; attempt++) {
    const [draft, thread] = await Promise.all([
      readRecordsByKeys(
        host,
        selectRecords(EmailThreadMessageFieldsFragmentDoc),
        [`GraphqlSoupEmailMessage:${draftId}`]
      ),
      readRecordsByKeys(
        host,
        selectRecords(EmailDraftThreadFieldsFragmentDoc),
        [`GraphqlSoupEmailThread:${threadId}`]
      ),
    ]);
    if (draft.revision !== thread.revision) continue;
    return {
      draftId: draft.records[0]?.record.id ?? draftId,
      threadDbId: thread.records[0]?.record.id ?? threadId,
      existingDraft: draft.records[0]?.record,
      existingThread: thread.records[0]?.record,
      mutationUuid: draft.records[0]?.identity?.mutationUuid ?? undefined,
    };
  }
  throw new Error('Email draft cache kept changing; retry the draft write');
}

/** Saves over the queue; a commit mirrors useSaveDraftMutation's cache effects. */
export async function saveEmailDraftQueued(input: {
  args: GraphqlSaveEmailDraftArgs;
  completingThread?: boolean;
  previousThreadId?: string;
}): Promise<QueuedDraftSave> {
  const local = await readLocalDraft(String(input.args.draftId));
  if (local && draftSyncPaused(local))
    return { kind: 'rejected', code: draftFailureCode(local.errorCode) };
  const attempt = local
    ? await beginDraftAttempt(
        { ...local, revision: input.args.localRevision ?? local.revision },
        'save'
      )
    : undefined;
  const cached = await readCachedDraftAndThread(
    String(input.args.draftId),
    input.args.threadDbId
  );
  const outcome = await executeGraphqlSaveEmailDraft(getGraphqlSoupClient(), {
    ...input.args,
    ...cached,
    ...(local ? { draftId: local.draftId, clientMetadata: attempt } : {}),
    mutationUuid:
      cached.mutationUuid ??
      input.args.mutationUuid ??
      String(input.args.draftId),
  });
  if (outcome.kind === 'failed') {
    return {
      kind: 'rejected',
      code: rejection(
        outcome.code,
        'Failed to save draft',
        input.args.threadDbId
      ),
    };
  }
  if (outcome.kind === 'queued') {
    if (attempt) {
      try {
        await markDraftAttemptQueued(attempt);
      } catch (error) {
        reportError(error);
      }
    }
    return { kind: 'queued' };
  }
  try {
    markThreadDraftSaved(outcome.threadId);
    if (input.previousThreadId && input.previousThreadId !== outcome.threadId) {
      markThreadDraftSaved(input.previousThreadId);
      invalidateSoupEntity(input.previousThreadId);
      void refetchSoupEntity(input.previousThreadId, 'emailThread').catch(
        reportError
      );
    }
    void queryClient.invalidateQueries({ queryKey: emailKeys.previews._def });
    if (!input.completingThread) {
      void refetchSoupEntity(outcome.threadId, 'emailThread').catch(
        reportError
      );
    }
    void queryClient.invalidateQueries({
      queryKey: emailKeys.threadMessages(outcome.threadId).queryKey,
    });
  } catch (error) {
    reportError(error);
  }
  return {
    kind: 'committed',
    draftId: outcome.draftId,
    threadId: outcome.threadId,
  };
}

/** Deletes over the queue; a commit mirrors useDeleteDraftMutation's cache effects. */
export async function deleteEmailDraftQueued(input: {
  draftId: string;
  threadId: string;
  completingThread?: boolean;
}): Promise<QueuedDraftDelete> {
  const local = await readLocalDraft(input.draftId);
  const attempt = local ? await beginDraftAttempt(local, 'delete') : undefined;
  const cached = await readCachedDraftAndThread(input.draftId, input.threadId);
  const outcome = await executeGraphqlDeleteEmailDraft(getGraphqlSoupClient(), {
    existingThread: cached.existingThread,
    mutationUuid: cached.mutationUuid ?? input.draftId,
    draftId: local?.draftId ?? String(cached.draftId),
    clientMetadata: attempt,
    threadDbId: cached.threadDbId,
  });
  if (outcome.kind === 'failed') {
    return {
      kind: 'rejected',
      code: rejection(outcome.code, 'Failed to delete draft', input.threadId),
    };
  }
  if (outcome.kind === 'queued') {
    if (attempt) {
      try {
        await markDraftAttemptQueued(attempt);
      } catch (error) {
        reportError(error);
      }
    }
    return { kind: 'queued' };
  }
  try {
    markThreadDraftSaved(input.threadId);
    void queryClient.invalidateQueries({ queryKey: emailKeys.previews._def });
    if (!input.completingThread) {
      void refetchSoupEntity(input.threadId, 'emailThread').catch(reportError);
      invalidateAllSoup();
    }
  } catch (error) {
    reportError(error);
  }
  return { kind: 'committed' };
}

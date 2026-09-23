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
import { EmailThreadMessageFieldsFragmentDoc } from '@service-storage/graphql/generated/graphql';
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
  executeGraphqlDeleteEmailDraft,
  executeGraphqlSaveEmailDraft,
  type GraphqlSaveEmailDraftArgs,
  type SaveEmailDraftFailureCode,
} from './graphql/draft';
import { emailKeys } from './keys';
import { fetchAndCacheThread, type ThreadQueryTransport } from './thread';

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

/** Saves over the queue; a commit mirrors useSaveDraftMutation's cache effects. */
export async function saveEmailDraftQueued(input: {
  args: GraphqlSaveEmailDraftArgs;
  completingThread?: boolean;
  previousThreadId?: string;
}): Promise<QueuedDraftSave> {
  const client = getGraphqlSoupClient();
  const host = getGraphqlCacheHost();
  const cached = host
    ? await readRecordsByKeys(
        host,
        selectRecords(EmailThreadMessageFieldsFragmentDoc),
        [`GraphqlSoupEmailMessage:${input.args.draftId}`]
      )
    : undefined;
  const outcome = await executeGraphqlSaveEmailDraft(client, {
    ...input.args,
    existingDraft: cached?.records[0]?.record,
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
  if (outcome.kind === 'queued') return { kind: 'queued' };
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
  const outcome = await executeGraphqlDeleteEmailDraft(getGraphqlSoupClient(), {
    draftId: input.draftId,
    threadDbId: input.threadId,
  });
  if (outcome.kind === 'failed') {
    return {
      kind: 'rejected',
      code: rejection(outcome.code, 'Failed to delete draft', input.threadId),
    };
  }
  if (outcome.kind === 'queued') return { kind: 'queued' };
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

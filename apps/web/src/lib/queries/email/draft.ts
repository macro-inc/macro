import { DraftTransferAborted } from '@app/features/email-compose/context/compose-capabilities';
import { fireAndForget } from '@core/util/fireAndForget';
import { ThrownResultError, throwOnErr } from '@core/util/result';
import { sleep } from '@core/util/sleep';
import { type Span, Telemetry } from '@macro-inc/observability';
import { invalidateAllSoup, refetchSoupEntity } from '@queries/soup/cache';
import { emailClient } from '@service-email/client';
import type {
  ApiDraftInput,
  CreateDraftResponse,
  TransferDraftResponse,
} from '@service-email/generated/schemas';
import { getGraphqlCacheHost } from '@service-storage/graphql-soup';
import { useMutation } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { type MutationCallbacks, withCallbacks } from '../utils';
import { refreshEmailThreadCache } from './cache-cleanup';
import { emailKeys } from './keys';

type CreateDraftParams = {
  draft: ApiDraftInput;
  /** Target inbox for a non-primary inbox; sent as the X-Email-Link-Id header. */
  linkId?: string;
  /** Skip updating soup when the thread will immediately be marked done. */
  skipSoupRefetch?: boolean;
};

/**
 * Mutation to save a new email draft.
 */
export function useSaveDraftMutation(
  callbacks?: MutationCallbacks<CreateDraftResponse, Error, CreateDraftParams>
) {
  return useMutation(() => ({
    mutationFn: async (vars: CreateDraftParams) => {
      return await throwOnErr(
        async () =>
          await emailClient.createDraft({ draft: vars.draft }, vars.linkId)
      );
    },
    ...withCallbacks<CreateDraftResponse, Error, CreateDraftParams>(
      {
        onError(error) {
          console.error('Failed to save draft', error);
        },
        onSuccess(data, vars) {
          try {
            void queryClient
              .invalidateQueries({
                queryKey: emailKeys.previews._def,
              })
              .catch(Telemetry.error);
            const threadId = data.draft.thread_db_id;
            if (!threadId) return;
            if (!vars.skipSoupRefetch) {
              void refetchSoupEntity(threadId, 'emailThread').catch(
                Telemetry.error
              );
            }
          } catch (error) {
            Telemetry.error(error);
          }
        },
      },
      callbacks
    ),
  }));
}

type DeleteDraftParams = {
  draftId: string;
  draftGeneration?: number;
  /** Thread the draft belonged to, refetched so it leaves the drafts tab. */
  threadId?: string;
  /** Target inbox for a non-primary inbox; sent as the X-Email-Link-Id header. */
  linkId?: string;
  /** Skip updating soup when the thread will immediately be marked done. */
  skipSoupRefetch?: boolean;
};

/**
 * Mutation to delete an email draft.
 */
export function useDeleteDraftMutation(
  callbacks?: MutationCallbacks<void, Error, DeleteDraftParams>
) {
  return useMutation(() => ({
    mutationFn: async (vars: DeleteDraftParams) => {
      await throwOnErr(
        async () =>
          await emailClient.deleteDraft(
            { id: vars.draftId, draftGeneration: vars.draftGeneration },
            vars.linkId
          )
      );
    },
    ...withCallbacks<void, Error, DeleteDraftParams>(
      {
        onError(error) {
          console.error('Failed to delete draft', error);
        },
        async onSuccess(_data, vars) {
          try {
            if (vars.threadId) {
              await refreshEmailThreadCache(vars.threadId);
            }
            void queryClient
              .invalidateQueries({
                queryKey: emailKeys.previews._def,
              })
              .catch(Telemetry.error);
            if (vars.skipSoupRefetch) return;
            // Refetch the thread (not the deleted draft) so its draft-derived
            // fields settle. No-op for compose drafts, whose thread is deleted
            // along with the draft, so the refetch finds nothing to update.
            if (vars.threadId) {
              void refetchSoupEntity(vars.threadId, 'emailThread').catch(
                Telemetry.error
              );
            }
            // Discarding a draft changes view membership — the thread leaves
            // Signal/Drafts and a noise thread re-enters Noise — which a
            // single-entity patch can't express, so the soup list queries must
            // refetch. Mirrors the archive flow in EmailContext.
            invalidateAllSoup();
          } catch (error) {
            Telemetry.error(error);
          }
        },
      },
      callbacks
    ),
  }));
}

type TransferEmailDraftInput = {
  operationId: string;
  draftId: string;
  draftGeneration?: number;
  sourceInboxId: string;
  destinationInboxId: string;
};

/** How long a refused move waits for the draft's last save to reach its provider. */
const TRANSFER_SYNC_WAIT_MS = 30_000;
/** Requests one move makes when the draft keeps syncing between them. */
const TRANSFER_ATTEMPTS = 3;
const SYNC_POLL_DELAYS_MS = [250, 500, 1000];

/** Moving creates a new server identity; old queued mutations retain their old target. */
export function transferEmailDraft(input: TransferEmailDraftInput) {
  return Telemetry.span('email.draft_transfer.request', async (span) => {
    let result: TransferDraftResponse;
    try {
      result = await requestDraftTransfer(input, span);
      span.setAttr('email.draft_transfer.committed_by', 'response');
    } catch (originalError) {
      const recovery = await span.span(
        'email.draft_transfer.recover',
        async (recover) => {
          try {
            return await throwOnErr(() =>
              emailClient.recoverDraftTransfer(input.operationId)
            );
          } catch (error) {
            recover.error('Draft transfer recovery failed');
            span.error('Draft transfer recovery failed');
            throw error;
          }
        }
      );
      if (!recovery.committed) {
        span.error('Draft transfer aborted');
        throw new DraftTransferAborted(
          'The inbox change did not complete. Your original draft is preserved; you can edit it and try again.',
          { cause: originalError }
        );
      }
      span.setAttr('email.draft_transfer.committed_by', 'recovery');
      result = recovery.committed;
    }
    // Cache refresh errors must not turn a committed move into a failed write.
    // The caller shows the moved draft first. Evicting the source thread
    // replaces a route that still shows it with the not-found page.
    fireAndForget(
      span.span('email.draft_transfer.refresh', async (refresh) => {
        try {
          await refreshTransferredThreads(result, refresh);
        } catch (error) {
          refresh.error('Draft transfer refresh failed');
          throw error;
        }
      }),
      'email-draft-transfer'
    );
    return result;
  });
}

/**
 * The service refuses to move a draft while its last save is still being
 * written to the provider. An Outlook draft is written after the save
 * returns, and the composer saves just before it asks for the move, so the
 * move often arrives during that write. A refusal then waits for the write
 * and asks again with the same operation ID: a refused move is not
 * committed, and the service treats a repeated ID as the same move. Each
 * request runs in the move's span: after an await the browser has no
 * active trace context to carry.
 */
async function requestDraftTransfer(
  input: TransferEmailDraftInput,
  span: Span
): Promise<TransferDraftResponse> {
  const deadline = Date.now() + TRANSFER_SYNC_WAIT_MS;
  for (let attempt = 1; ; attempt += 1) {
    span.setAttr('email.draft_transfer.attempts', attempt);
    const result = await span.run(() =>
      emailClient.transferDraft(
        input.draftId,
        {
          operation_id: input.operationId,
          draft_generation: input.draftGeneration ?? 0,
          destination_link_id: input.destinationInboxId,
        },
        input.sourceInboxId
      )
    );
    if (result.isOk()) return result.value;
    const refused = result.error.some((error) => error.code === 'CONFLICT');
    const retry =
      refused &&
      attempt < TRANSFER_ATTEMPTS &&
      (await span.span('email.draft_transfer.await_sync', (wait) =>
        awaitProviderWrite(input.draftId, deadline, attempt, wait)
      ));
    if (!retry) throw new ThrownResultError(result.error);
  }
}

/**
 * True when the refusal can be put down to the draft's provider write and
 * that write has ended: the draft's operation left PENDING while this waited
 * (for SYNCHRONIZED, or for none once an earlier move's cleanup ends). A
 * first refusal that finds the write already done asks once more, since the
 * write may have ended just after the refusal. False for a draft with no
 * write in flight (a Gmail draft), a write that ended in another state, a
 * failed read, or a write still running at `deadline`.
 */
async function awaitProviderWrite(
  draftId: string,
  deadline: number,
  attempt: number,
  span: Span
): Promise<boolean> {
  let polls = 0;
  let outcome: string;
  while (true) {
    polls += 1;
    const read = await span.run(() => emailClient.messageOperation(draftId));
    if (read.isErr()) {
      outcome = 'read_failed';
      break;
    }
    const state = read.value.operation?.state;
    if (state !== 'PENDING') {
      outcome = state ?? 'none';
      break;
    }
    const delay =
      SYNC_POLL_DELAYS_MS[Math.min(polls, SYNC_POLL_DELAYS_MS.length) - 1];
    if (Date.now() + delay > deadline) {
      outcome = 'timed_out';
      break;
    }
    await sleep(delay);
  }
  const waited = polls > 1;
  const retry = waited
    ? outcome === 'SYNCHRONIZED' || outcome === 'none'
    : outcome === 'SYNCHRONIZED' && attempt === 1;
  span.setAttr('email.draft_transfer.sync_polls', polls);
  span.setAttr('email.draft_transfer.sync_outcome', outcome);
  span.setAttr('email.draft_transfer.retry', retry);
  return retry;
}

async function refreshTransferredThreads(
  result: TransferDraftResponse,
  parent: Span
) {
  await getGraphqlCacheHost()?.deleteRecords([
    `GraphqlSoupEmailMessage:${result.source_id}`,
  ]);
  await Promise.all([
    parent.run(() => refreshEmailThreadCache(result.source_thread_id)),
    parent.run(() => refreshEmailThreadCache(result.thread_id)),
  ]);
  invalidateAllSoup();
}

import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { type EmailEntity, type EntityData, isEmailEntity } from '@entity';
import { Telemetry } from '@macro-inc/observability';
import { useDeleteDraftMutation } from '@queries/email/draft';
import { markThreadDraftSaved } from '@queries/email/draft-cache';
import { publishDraftLifecycleChange } from '@queries/email/draft-lifecycle-events';
import {
  deleteEmailDraftQueued,
  draftQueueActive,
} from '@queries/email/draft-queue';
import { useNonPrimaryEmailLinkIdHeader } from '@queries/email/link';
import {
  readThreadDrafts,
  type ThreadDraftHandle,
} from '@queries/email/thread-drafts';
import { err, ok, type Result, ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';
import type { EntityActionListState } from './entity-action-context';

type DiscardFailure =
  | { kind: 'thread-unavailable'; codes: string[] }
  /** The draft queue already showed its own notice for this rejection. */
  | { kind: 'rejected'; code: string }
  | { kind: 'delete-failed'; error: unknown };

const deleteFailed = (error: unknown): DiscardFailure => ({
  kind: 'delete-failed',
  error,
});

/**
 * Discards the drafts on email thread rows, as the composer's discard
 * shortcut does, without opening them. The thread keeps its row and its
 * place in the list; only the draft badge and preview fall back to the
 * thread's latest message.
 */
export const makeDiscardDraftAction = () => {
  const remove = useDeleteDraftMutation();
  const toHeaderLinkId = useNonPrimaryEmailLinkIdHeader();

  const canExecute = (entity: EntityData): entity is EmailEntity =>
    isEmailEntity(entity) && entity.isDraft;

  const deleteDraft = async (
    threadId: string,
    draft: ThreadDraftHandle
  ): Promise<Result<void, DiscardFailure>> => {
    if (draftQueueActive()) {
      const outcome = await ResultAsync.fromPromise(
        deleteEmailDraftQueued({
          draftId: draft.draftId,
          draftGeneration: draft.draftGeneration,
          threadId,
        }),
        deleteFailed
      );
      if (outcome.isErr()) return err(outcome.error);
      if (outcome.value.kind === 'rejected')
        return err({ kind: 'rejected', code: outcome.value.code });
    } else {
      const removed = await ResultAsync.fromPromise(
        remove.mutateAsync({
          draftId: draft.draftId,
          draftGeneration: draft.draftGeneration,
          threadId,
          linkId: toHeaderLinkId(draft.inboxId),
        }),
        deleteFailed
      );
      if (removed.isErr()) return err(removed.error);
      markThreadDraftSaved(threadId);
    }
    // An open composer on this draft rereads it and closes.
    publishDraftLifecycleChange(draft.draftId, draft.inboxId);
    return ok(undefined);
  };

  const discardThreadDrafts = (
    thread: EmailEntity
  ): Promise<Result<number, DiscardFailure>> =>
    Telemetry.span('email.draft_discard.list', async (span) => {
      span.setAttr('email.thread_id', thread.id);
      const drafts = await readThreadDrafts(thread.id);
      if (drafts.isErr()) {
        span.error('Thread drafts unavailable');
        return err(drafts.error);
      }
      span.setAttr('email.draft_discard.count', drafts.value.length);
      for (const draft of drafts.value) {
        const deleted = await deleteDraft(thread.id, draft);
        if (deleted.isErr()) {
          span.error(`Draft discard ${deleted.error.kind}`);
          return err(deleted.error);
        }
      }
      return ok(drafts.value.length);
    });

  const reportFailure = (failure: DiscardFailure) =>
    match(failure)
      .with({ kind: 'thread-unavailable' }, ({ codes }) =>
        Telemetry.error(
          new Error(`Thread drafts unavailable: ${codes.join(', ')}`)
        )
      )
      .with({ kind: 'rejected' }, () => undefined)
      .with({ kind: 'delete-failed' }, ({ error }) => Telemetry.error(error))
      .exhaustive();

  const execute = async (entities: EntityData[]) => {
    const threads = entities.filter(canExecute);
    if (threads.length === 0) return;

    const results = await Promise.all(threads.map(discardThreadDrafts));
    const failures = results.flatMap((result) =>
      result.isErr() ? [result.error] : []
    );
    if (failures.length > 0) {
      failures.forEach(reportFailure);
      if (failures.some((failure) => failure.kind !== 'rejected'))
        toast.failure(t('entityActions.toastDiscardDraftFailed'));
      return;
    }
    const discarded = results.reduce(
      (sum, result) => sum + (result.isOk() ? result.value : 0),
      0
    );
    if (discarded === 0) return;
    toast.success(
      t('entityActions.toastDiscardedDrafts', { count: discarded }),
      { duration: 3_000, stack: true, hideOnMobile: true }
    );
  };

  /** Rows stay where they are, even though the thread's sort time moves back
   *  to its latest received message. */
  const executeWithSoup = async (
    entities: EntityData[],
    soup: EntityActionListState
  ) => {
    soup.positions?.hold(entities.filter(canExecute).map(({ id }) => id));
    await execute(entities);
  };

  return { canExecute, execute, executeWithSoup };
};

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
import type { EntityActionListState } from './entity-action-context';

/** The queue already reported this rejection with its own notice. */
class DraftDeleteRejected extends Error {}

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

  const deleteDraft = async (threadId: string, draft: ThreadDraftHandle) => {
    if (draftQueueActive()) {
      const outcome = await deleteEmailDraftQueued({
        draftId: draft.draftId,
        draftGeneration: draft.draftGeneration,
        threadId,
      });
      if (outcome.kind === 'rejected')
        throw new DraftDeleteRejected(outcome.code);
    } else {
      await remove.mutateAsync({
        draftId: draft.draftId,
        draftGeneration: draft.draftGeneration,
        threadId,
        linkId: toHeaderLinkId(draft.inboxId),
      });
      markThreadDraftSaved(threadId);
    }
    // An open composer on this draft rereads it and closes.
    publishDraftLifecycleChange(draft.draftId, draft.inboxId);
  };

  const discardThreadDrafts = (thread: EmailEntity) =>
    Telemetry.span('email.draft_discard.list', async (span) => {
      span.setAttr('email.thread_id', thread.id);
      const drafts = await readThreadDrafts(thread.id);
      span.setAttr('email.draft_discard.count', drafts.length);
      for (const draft of drafts) await deleteDraft(thread.id, draft);
      return drafts.length;
    });

  const execute = async (entities: EntityData[]) => {
    const threads = entities.filter(canExecute);
    if (threads.length === 0) return;

    const results = await Promise.allSettled(threads.map(discardThreadDrafts));
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : []
    );
    if (failures.length > 0) {
      failures.forEach((error) => Telemetry.error(error));
      if (failures.some((error) => !(error instanceof DraftDeleteRejected)))
        toast.failure(t('entityActions.toastDiscardDraftFailed'));
      return;
    }
    const discarded = results.reduce(
      (sum, result) => sum + (result.status === 'fulfilled' ? result.value : 0),
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

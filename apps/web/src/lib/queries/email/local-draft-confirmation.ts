import type { LocalDraft } from '@app/features/email-compose/core/local-draft';
import {
  draftSyncPaused,
  emailStorageSession,
  localDraftStore,
} from './local-drafts';

/** REST autosave confirms the same independent working copy used by the outbox. */
export async function confirmLocalDraftSave(
  saved: LocalDraft | undefined,
  result: { draftId?: string; threadId?: string }
) {
  if (!saved || !result.draftId) return;
  const session = await emailStorageSession();
  if (session.accountId !== saved.accountId) return;
  await localDraftStore.update(session, saved.key, (current) => {
    if (
      current.generation !== saved.generation ||
      current.acknowledgedRevision > saved.revision
    )
      return current;
    return {
      ...current,
      serverDraftId: result.draftId,
      serverThreadId: result.threadId ?? current.serverThreadId,
      acknowledgedRevision: saved.revision,
      status:
        draftSyncPaused(current) || current.status === 'deleting'
          ? current.status
          : current.revision === saved.revision &&
              !current.attachments.some(
                (file) => file.type === 'local' && !file.uploaded
              )
            ? 'synced'
            : 'dirty',
    };
  });
}

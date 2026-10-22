import type { LocalDraft } from '@app/features/email-compose/core/local-draft';
import type { EmailEntity } from '@entity';

/** One conversation row, even when several local reply drafts share it. */
export function localDraftEntities(
  drafts: readonly LocalDraft[]
): EmailEntity[] {
  const rows = new Map<string, EmailEntity>();
  for (const draft of drafts) {
    if (
      draft.status === 'synced' ||
      (draft.status === 'deleting' &&
        draft.queuedAttemptId &&
        draft.queuedAttemptId === draft.latestAttemptId)
    )
      continue;
    const id = draft.serverThreadId ?? draft.threadId ?? draft.key;
    if (rows.has(id)) continue;
    rows.set(id, {
      type: 'email',
      id,
      name: draft.content.subject || 'Draft email',
      ownerId: draft.accountId,
      isRead: true,
      isDraft: true,
      isImportant: false,
      isSignal: true,
      done: false,
      linkId: draft.inboxId,
      senderEmail: draft.senderEmail,
      participants: (draft.content.to ?? []).map((contact) => ({
        email: contact.email,
        name: contact.name ?? undefined,
      })),
      createdAt: new Date(draft.updatedAt),
      updatedAt: new Date(draft.updatedAt),
      snippet:
        draft.status === 'failed' ||
        draft.status === 'unconfirmed' ||
        draft.status === 'delete-failed'
          ? 'Saved on this device · Not synced'
          : 'Saved on this device',
    });
  }
  return [...rows.values()];
}

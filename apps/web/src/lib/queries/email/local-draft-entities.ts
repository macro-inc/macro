import type { LocalDraft } from '@app/features/email-compose/core/local-draft';
import type { EmailEntity } from '@entity';

/** Whether a local working copy still shows as its own draft row. */
export function isListedLocalDraft(draft: LocalDraft): boolean {
  return draft.status !== 'synced' && draft.status !== 'deleting';
}

/** The conversation row a local working copy appears under. */
export function localDraftRowId(draft: LocalDraft): string {
  return draft.serverThreadId ?? draft.threadId ?? draft.key;
}

/** One conversation row, even when several local reply drafts share it. */
export function localDraftEntities(
  drafts: readonly LocalDraft[]
): EmailEntity[] {
  const rows = new Map<string, EmailEntity>();
  for (const draft of drafts) {
    if (!isListedLocalDraft(draft)) continue;
    const id = localDraftRowId(draft);
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

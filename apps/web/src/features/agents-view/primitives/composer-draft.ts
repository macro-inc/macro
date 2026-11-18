import { createInputAttachmentTracker } from '@channel/Input/attachment-tracker';
import { holdPersistedDraftText } from '@channel/Input/shared-draft';
import type { InputAttachmentTracker } from '@channel/Input/types';
import { createPersistenceKey } from '@queries/persistence';
import { type Accessor, createMemo, createSignal } from 'solid-js';

/** Same localStorage projection channel composers use for unsent drafts. */
export const NEW_CONVERSATION_DRAFT_KEY = createPersistenceKey(
  'input-value-agents-new-conversation',
  0
);

/** Home owns its draft separately from the Agents page's New conversation. */
export const HOME_CONVERSATION_DRAFT_KEY = createPersistenceKey(
  'input-value-home-agent-conversation',
  0
);

export const NEW_CONVERSATION_ATTACHMENTS_KEY = createPersistenceKey(
  'attachment-tracker-agents-new-conversation',
  0
);

/** Home owns its attachments separately from the Agents page composer. */
export const HOME_CONVERSATION_ATTACHMENTS_KEY = createPersistenceKey(
  'attachment-tracker-home-agent-conversation',
  0
);

/** Keep a composer draft after the New conversation page remounts. */
export function createPersistedComposerDraft(
  name = NEW_CONVERSATION_DRAFT_KEY,
  userId: Accessor<string | undefined> = () => undefined
) {
  const state = createMemo(() => {
    const identity = userId();
    if (!identity) return createSignal<string | undefined>(undefined);

    return holdPersistedDraftText(`${name}:${encodeURIComponent(identity)}`);
  });
  return {
    draft: () => state()[0]() ?? '',
    setDraft: (value: string) => state()[1](value || undefined),
  };
}

/**
 * The files attached to a composer draft. Call it inside the owner that uses
 * them. Unknown identities never read shared storage.
 */
export function createPersistedComposerAttachments(
  name: string,
  identity: string | undefined
): InputAttachmentTracker {
  if (!identity) return createInputAttachmentTracker();

  return createInputAttachmentTracker({
    persistenceKey: `${name}:${encodeURIComponent(identity)}`,
  });
}

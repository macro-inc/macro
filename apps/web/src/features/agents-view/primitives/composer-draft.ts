import { createPersistenceKey } from '@queries/persistence';
import { makePersisted } from '@solid-primitives/storage';
import { createSignal } from 'solid-js';

/** Same localStorage projection channel composers use for unsent drafts. */
export const NEW_CONVERSATION_DRAFT_KEY = createPersistenceKey(
  'input-value-agents-new-conversation',
  0
);

export const NEW_CONVERSATION_ATTACHMENTS_KEY = createPersistenceKey(
  'attachment-tracker-agents-new-conversation',
  0
);

/** Keep a composer draft after the New conversation page remounts. */
export function createPersistedComposerDraft(
  name = NEW_CONVERSATION_DRAFT_KEY
) {
  const raw = createSignal<string | undefined>(undefined);
  const [persisted, setPersisted] = makePersisted(raw, { name });
  return {
    draft: () => persisted() ?? '',
    setDraft: (value: string) => setPersisted(value || undefined),
  };
}

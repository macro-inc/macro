import { createPersistenceKey } from '@queries/persistence';
import { makePersisted } from '@solid-primitives/storage';
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

/** Keep a composer draft after the New conversation page remounts. */
export function createPersistedComposerDraft(
  name = NEW_CONVERSATION_DRAFT_KEY,
  userId: Accessor<string | undefined> = () => undefined
) {
  const state = createMemo(() => {
    const identity = userId();
    const raw = createSignal<string | undefined>(undefined);
    return identity
      ? makePersisted(raw, {
          name: `${name}:${encodeURIComponent(identity)}`,
        })
      : raw;
  });
  return {
    draft: () => state()[0]() ?? '',
    setDraft: (value: string) => state()[1](value || undefined),
  };
}

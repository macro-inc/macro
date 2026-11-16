import { createInputAttachmentTracker } from '@channel/Input/attachment-tracker';
import type { InputAttachmentTracker } from '@channel/Input/types';
import { createPersistenceKey } from '@queries/persistence';
import { makePersisted } from '@solid-primitives/storage';
import {
  type Accessor,
  createMemo,
  createRoot,
  createSignal,
  onCleanup,
  type Signal,
} from 'solid-js';

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

type Shared<T> = {
  value: T;
  holders: number;
  dispose: () => void;
};

/**
 * Every composer mounted on one stored draft, like the Agents page and the
 * phone list's composer, shares one copy of its text and files. A composer
 * with its own copy would write it back over newer changes made in the other.
 * A copy is dropped once no composer holds it, so the next mount reads
 * storage again.
 */
const SHARED_DRAFTS = new Map<string, Shared<Signal<string | undefined>>>();
const SHARED_ATTACHMENTS = new Map<string, Shared<InputAttachmentTracker>>();

function holdShared<T>(
  registry: Map<string, Shared<T>>,
  name: string,
  create: () => T
): T {
  let shared = registry.get(name);
  if (!shared) {
    shared = createRoot((dispose) => ({
      value: create(),
      holders: 0,
      dispose,
    }));
    registry.set(name, shared);
  }

  const held = shared;
  held.holders += 1;
  onCleanup(() => {
    held.holders -= 1;
    if (held.holders > 0) return;
    registry.delete(name);
    held.dispose();
  });
  return held.value;
}

/** Keep a composer draft after the New conversation page remounts. */
export function createPersistedComposerDraft(
  name = NEW_CONVERSATION_DRAFT_KEY,
  userId: Accessor<string | undefined> = () => undefined
) {
  const state = createMemo(() => {
    const identity = userId();
    if (!identity) return createSignal<string | undefined>(undefined);

    const storageName = `${name}:${encodeURIComponent(identity)}`;
    return holdShared(
      SHARED_DRAFTS,
      storageName,
      (): Signal<string | undefined> => {
        const [draft, setDraft] = makePersisted(
          createSignal<string | undefined>(undefined),
          { name: storageName }
        );
        return [draft, setDraft];
      }
    );
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

  const persistenceKey = `${name}:${encodeURIComponent(identity)}`;
  return holdShared(SHARED_ATTACHMENTS, persistenceKey, () =>
    createInputAttachmentTracker({ persistenceKey })
  );
}

import { createRoot } from 'solid-js';
import { createInputAttachmentTracker } from './attachment-tracker';
import { holdPersistedDraftText } from './shared-draft';
import {
  makeAttachmentTrackerPersistenceKey,
  makeInputValuePersistenceKey,
  type PersistenceProps,
} from './utils/persistence';

/**
 * Whether an unsent draft (text or files) is stored for this channel or
 * thread. Reads the copy a mounted input shares, or storage when none is
 * mounted, without subscribing the caller.
 */
export function hasStoredDraft(scope: PersistenceProps): boolean {
  return createRoot((dispose) => {
    const [text] = holdPersistedDraftText(makeInputValuePersistenceKey(scope));
    const stored =
      !!text()?.trim() ||
      createInputAttachmentTracker({
        persistenceKey: makeAttachmentTrackerPersistenceKey(scope),
      }).attachments().length > 0;
    dispose();
    return stored;
  });
}

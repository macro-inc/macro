import type { MessageParent } from '@service-storage/messages';
import { createRoot } from 'solid-js';
import { createInputAttachmentTracker } from '../Input/attachment-tracker';
import { holdPersistedDraftText } from '../Input/shared-draft';
import type {
  InputHandle,
  InputPersistenceKey,
  InputSnapshot,
} from '../Input/types';
import {
  makeAttachmentTrackerPersistenceKey,
  makeInputValuePersistenceKey,
} from '../Input/utils/persistence';
import { hasSendableInputContent } from '../Input/utils/sendable-content';

/** Where a thread's reply draft is stored: its text and its attachments. */
export type ReplyDraftKeys = {
  text: InputPersistenceKey;
  attachments: string;
};

export function replyDraftKeys(
  parent: MessageParent,
  threadId: string
): ReplyDraftKeys {
  const scope = { channelId: `${parent.type}:${parent.id}`, threadId };
  return {
    text: makeInputValuePersistenceKey(scope),
    attachments: makeAttachmentTrackerPersistenceKey(scope),
  };
}

/**
 * Reply inputs mounted now, per stored draft, newest last. A reply's send
 * outlives the input that sent it, and even the view around it, so its
 * failure finds the input showing that thread's draft here.
 */
const MOUNTED = new Map<string, InputHandle[]>();

/** Lists a mounted reply input; the returned function unlists it. */
export function registerReplyInput(
  keys: ReplyDraftKeys,
  handle: InputHandle
): () => void {
  MOUNTED.set(keys.text, [...(MOUNTED.get(keys.text) ?? []), handle]);
  return () => {
    const rest = (MOUNTED.get(keys.text) ?? []).filter((h) => h !== handle);
    if (rest.length > 0) MOUNTED.set(keys.text, rest);
    else MOUNTED.delete(keys.text);
  };
}

/**
 * Puts a failed reply back into its thread's draft, unless that draft holds
 * something newer, typed in any view of the thread. A mounted input shows it
 * at once; otherwise it is stored, and the next input to open there reads it.
 * Returns whether the draft came back.
 */
export function restoreFailedReply(
  keys: ReplyDraftKeys,
  snapshot: InputSnapshot
): boolean {
  const mounted = MOUNTED.get(keys.text)?.at(-1);
  if (mounted) {
    if (hasSendableInputContent(mounted.snapshot())) return false;
    mounted.restoreSnapshot(snapshot, { focus: false });
    return true;
  }
  return createRoot((dispose) => {
    try {
      const [text, setText] = holdPersistedDraftText(keys.text);
      const tracker = createInputAttachmentTracker({
        persistenceKey: keys.attachments,
      });
      if (text()?.trim() || tracker.attachments().length > 0) return false;
      setText(snapshot.value || undefined);
      tracker.setAttachments(snapshot.attachments);
      return true;
    } finally {
      dispose();
    }
  });
}

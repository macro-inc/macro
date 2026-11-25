import { composerStorageWritable } from '@core/auth/clear-composer-storage';
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
 * Works on a thread's stored draft. Every reply input open on the thread
 * holds the same copy, so what is written here shows in each of them at
 * once, and is stored for one opened later.
 */
function withReplyDraft<T>(
  keys: ReplyDraftKeys,
  use: (draft: {
    text: () => string | undefined;
    setText: (text: string | undefined) => void;
    attachments: ReturnType<typeof createInputAttachmentTracker>;
  }) => T
): T {
  return createRoot((dispose) => {
    try {
      const [text, setText] = holdPersistedDraftText(keys.text);
      const attachments = createInputAttachmentTracker({
        persistenceKey: keys.attachments,
      });
      return use({ text, setText, attachments });
    } finally {
      dispose();
    }
  });
}

/** The thread's stored reply draft, if it holds anything. */
function readReplyDraft(keys: ReplyDraftKeys): InputSnapshot | undefined {
  return withReplyDraft(keys, ({ text, attachments }) => {
    const value = text() ?? '';
    const files = attachments.attachments();
    if (!value.trim() && files.length === 0) return undefined;
    // The editor finds the mentions in the text as it reads it.
    return { value, mentions: [], attachments: [...files] };
  });
}

/**
 * Puts a failed reply back into its thread's draft, unless that draft holds
 * something newer, typed in any view of the thread, or composer storage was
 * cleared (sign-out) since `generation` was read, before the send, or a
 * sign-out is clearing it now.
 * Returns whether the draft came back.
 */
export function restoreFailedReply(
  keys: ReplyDraftKeys,
  snapshot: InputSnapshot,
  generation: number
): boolean {
  if (!composerStorageWritable(generation)) return false;
  return withReplyDraft(keys, ({ text, setText, attachments }) => {
    if (text()?.trim() || attachments.attachments().length > 0) return false;
    setText(snapshot.value || undefined);
    attachments.setAttachments(snapshot.attachments);
    return true;
  });
}

/**
 * The reply draft to build on, such as for a quote: the thread's stored draft,
 * which every view of the thread writes, with the mentions of `live` (the
 * view's last snapshot) only while it still says the same. A composer that
 * closed keeps its last snapshot, which another view may have replaced since.
 */
export function currentReplyDraft(
  keys: ReplyDraftKeys,
  live: InputSnapshot | undefined
): InputSnapshot | undefined {
  const stored = readReplyDraft(keys);
  if (!stored) return undefined;
  const mentions = live?.value === stored.value ? live.mentions : [];
  return { ...stored, mentions };
}

/**
 * Writes a quote (`value`, built on the draft) into the thread's open reply
 * input. Only the text changes: the input keeps the attachments it holds
 * now, which an upload may have changed since the quote read the draft.
 */
export function applyQuoteText(
  handle: InputHandle | undefined,
  value: string
): void {
  if (!handle) return;
  handle.restoreSnapshot(
    { ...handle.snapshot(), value },
    { focus: false, cursor: 'trailing-paragraph' }
  );
}

import type { InputAttachmentData, InputSnapshot } from '../types';

type InputContent = {
  value?: string;
  attachments?: readonly InputAttachmentData[];
};

export function hasSendableInputContent(input: InputContent): boolean {
  return (
    input.value?.trim().length !== 0 || (input.attachments?.length ?? 0) > 0
  );
}

/**
 * The draft as it should be sent: without the blank lines empty paragraphs at
 * its end leave. Leaving a list with Enter ends the draft on one, and the
 * message would show it as a blank line at its bottom.
 */
export function sendableSnapshot(snapshot: InputSnapshot): InputSnapshot {
  const value = snapshot.value.replace(/(?:\n[^\S\n]*)+$/, '');
  return value === snapshot.value ? snapshot : { ...snapshot, value };
}

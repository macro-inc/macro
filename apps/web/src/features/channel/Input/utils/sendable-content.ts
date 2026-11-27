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
 *
 * The draft is cut at the first line break after its last text, keeping
 * spaces on that line. This runs in linear time; a regex anchored only at the
 * end backtracks over every run of line breaks in the draft.
 */
export function sendableSnapshot(snapshot: InputSnapshot): InputSnapshot {
  const { value } = snapshot;
  const end = value.indexOf('\n', value.trimEnd().length);
  return end === -1 ? snapshot : { ...snapshot, value: value.slice(0, end) };
}

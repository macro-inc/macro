/**
 * The composer's prompt action: what a draft and its attachment chips become
 * on the wire.
 *
 * Kept apart from the composer component so the shape can be tested without
 * standing up the session context the component reads.
 */

import type { InputAttachmentData } from '@channel/Input';
import { staticFileIdEndpoint } from '@core/constant/servers';
import type {
  AgentPromptAction,
  PromptAttachment,
} from '@service-agent-harness/generated/schemas';

/**
 * The prompt attachment for an uploaded file: the static file service URL
 * the agent fetches it from, plus what the chip knew about it.
 */
function promptAttachmentOf(attachment: InputAttachmentData): PromptAttachment {
  return {
    uri: staticFileIdEndpoint(attachment.id),
    name: attachment.name,
    ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
    ...(attachment.size !== undefined ? { size: attachment.size } : {}),
  };
}

/**
 * The prompt action for a draft and its attachments.
 *
 * A file still uploading is left out rather than sent half-there, and with
 * nothing to send the field is omitted entirely, so a plain prompt stays the
 * shape it has always been on the wire.
 */
export function promptActionOf(
  markdown: string,
  attachments: InputAttachmentData[]
): AgentPromptAction & { type: 'prompt' } {
  const ready = attachments
    .filter((attachment) => !attachment.pending)
    .map(promptAttachmentOf);
  return {
    type: 'prompt',
    prompt: markdown,
    ...(ready.length > 0 ? { attachments: ready } : {}),
  };
}

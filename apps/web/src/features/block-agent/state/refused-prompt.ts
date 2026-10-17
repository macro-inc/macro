import type { FoldedMessage } from '@service-agent-fold/generated/types';
import type { AgentAction } from '@service-agent-harness/generated/schemas';
import { isControlMessage } from './control-message';

/**
 * The prompt a refused turn answered, as an action that sends it again: the
 * user's text and attachments from that turn. `undefined` when the turn has
 * no prompt of its own to repeat.
 */
export function refusedPromptAction(
  messages: readonly FoldedMessage[],
  turn: number
): AgentAction | undefined {
  const prompt = messages.find(
    (message) =>
      message.turn === turn &&
      message.author.kind === 'user' &&
      !isControlMessage(message)
  );
  if (!prompt) return undefined;
  const text = prompt.parts
    .flatMap((part) => (part.kind === 'text' ? [part.text] : []))
    .join('');
  const attachments = prompt.parts.flatMap((part) =>
    part.kind === 'attachment'
      ? [
          {
            uri: part.uri,
            name: part.name,
            mimeType: part.mimeType,
            size: part.size,
          },
        ]
      : []
  );
  if (text.length === 0 && attachments.length === 0) return undefined;
  return {
    type: 'prompt',
    prompt: text,
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

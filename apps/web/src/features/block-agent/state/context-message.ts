import { stripAgentContext } from '@macro-inc/lexical-core/utils/parsers';
import type { FoldedMessage } from '@service-agent-fold/generated/types';

/** Private context still reaches the agent, but has no transcript row of its own. */
export function isContextOnlyMessage(message: FoldedMessage): boolean {
  if (message.author.kind !== 'user') return false;
  let hasContext = false;
  for (const part of message.parts) {
    if (part.kind !== 'text') return false;
    const visible = stripAgentContext(part.text);
    if (visible !== part.text) hasContext = true;
    if (visible.trim()) return false;
  }
  return hasContext;
}

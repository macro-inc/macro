import type {
  FoldedMessage,
  MessagePart,
  SessionNotification,
} from '@service-agent-fold/generated/types';
import { presentedReviewId } from './tool-groups';

/** Card subjects consume their events without adding transcript messages. */
export function timelineNotifications(
  messages: readonly FoldedMessage[],
  notifications: readonly SessionNotification[]
): SessionNotification[] {
  const subjects = new Set<string>();
  const visit = (parts: readonly MessagePart[]) => {
    for (const part of parts) {
      const subject = presentedReviewId(part);
      if (subject) subjects.add(subject);
      if (part.kind === 'tool_use' && part.detail.kind === 'subagent')
        visit(part.detail.children);
    }
  };
  for (const message of messages) visit(message.parts);
  return notifications.filter((event) => !subjects.has(event.subjectId));
}

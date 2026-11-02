/**
 * The harness reporting on background work it started earlier: a command
 * finishing, a subagent returning, a monitor streaming an event. The harness
 * hands the agent this report as a user turn; here it reads as punctuation in
 * the agent's reply, never as something a person said.
 */

import type { MessagePart } from '@service-agent-fold/generated/types';
import { ActionLine } from '../../ui';

type TaskNotificationPartData = Extract<
  MessagePart,
  { kind: 'task_notification' }
>;

/** The summary already names the task and its outcome; a monitor adds what it saw. */
export function taskNotificationLabel(part: TaskNotificationPartData): string {
  const summary = part.summary || 'Background task update';
  return part.event ? `${summary} · ${part.event}` : summary;
}

export function TaskNotificationPart(props: {
  part: TaskNotificationPartData;
}) {
  return (
    <ActionLine
      label={taskNotificationLabel(props.part)}
      failed={props.part.status === 'failed'}
    />
  );
}

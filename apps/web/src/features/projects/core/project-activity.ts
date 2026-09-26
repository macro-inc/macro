import type { ActivityAction, ActivityEvent } from '../../activity/core/event';

export type ProjectActivityRecord = {
  id: string;
  actorId: string;
  action: string;
  actionPayload?: unknown;
  occurredAt: string;
};

/** Unknown or incomplete payloads remain readable without treating their references as trusted. */
export function projectActivityEvent(
  projectId: string,
  record: ProjectActivityRecord
): ActivityEvent {
  const payload = record.actionPayload;
  const value =
    typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)
      : {};
  let action: ActivityAction;
  switch (record.action) {
    case 'created':
    case 'edited':
    case 'deleted':
    case 'opened':
    case 'messaged':
      action = { kind: record.action };
      break;
    case 'property_changed':
      action =
        typeof value.property === 'string'
          ? {
              kind: 'property-changed',
              property: value.property,
              from: value.from,
              to: value.to,
            }
          : { kind: 'unknown', tag: record.action };
      break;
    case 'task_added':
    case 'task_removed':
      action = {
        kind: record.action === 'task_added' ? 'task-added' : 'task-removed',
        taskId: typeof value.task_id === 'string' ? value.task_id : undefined,
      };
      break;
    default:
      action = { kind: 'unknown', tag: record.action };
  }
  const taskId =
    action.kind === 'task-added' || action.kind === 'task-removed'
      ? action.taskId
      : undefined;
  return {
    id: record.id,
    actorId: record.actorId,
    entityId: taskId ?? projectId,
    entityType: taskId ? 'document' : 'initiative',
    action,
    occurredAt: record.occurredAt,
  };
}

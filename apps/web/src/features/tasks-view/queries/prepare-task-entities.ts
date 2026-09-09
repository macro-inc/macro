import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import {
  type EntityData,
  isTaskEntity,
  type TaskEntityWithProperties,
} from '@entity/types/entity';
import type { NotificationSource } from '@notifications/notification-source';
import {
  type TaskViewContext,
  taskMatchesView,
} from '../filters/task-predicates';

/** Selects Tasks rows from query, search, and grouped continuation results. */
export function prepareTaskEntities(
  entities: EntityData[],
  context: TaskViewContext,
  source: NotificationSource
): TaskEntityWithProperties[] {
  return entities
    .filter(isTaskEntity)
    .filter((task) => taskMatchesView(task, context))
    .map((task) => withEntityNotifications(task, source))
    .filter(isTaskEntity);
}

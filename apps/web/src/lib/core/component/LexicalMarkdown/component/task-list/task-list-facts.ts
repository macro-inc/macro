import { combine, literal, NIL_UUID } from '@app/features/soup/filters/facets';
import {
  isTaskEntity,
  type TaskEntityWithProperties,
} from '@entity/types/entity';
import {
  getTaskAssigneeIds,
  getTaskDueDate,
  getTaskPriorityOptionId,
  getTaskStatusOptionId,
} from '@entity/utils/task-properties';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { type Accessor, createMemo } from 'solid-js';
import type { TaskInfo } from '../../plugins/checklist-controls/model';
import { useTaskListAssigneeNames } from './task-list-assignee-names';

/** Pin every non-document soup target so the query returns tasks only. */
const NON_TASK_TARGETS = {
  calf: literal('id', NIL_UUID),
  callf: literal('CallId', NIL_UUID),
  ccf: literal('id', NIL_UUID),
  cf: literal('cid', NIL_UUID),
  chanf: literal('ChannelId', NIL_UUID),
  cthf: literal('ThreadId', NIL_UUID),
  ef: literal('ThreadId', NIL_UUID),
  fef: literal('id', NIL_UUID),
  pf: literal('pid', NIL_UUID),
};

/** Names for the assignees the list references, independent of either editor graph. */
export function createTaskListNames(referenced: Accessor<readonly string[]>) {
  const resolveName = useTaskListAssigneeNames(referenced);
  const nameById = createMemo(
    () => new Map(referenced().map((id) => [id, resolveName(id)]))
  );
  return { nameById, resolveName };
}

/** Shared real soup query and task-property projection, including pending fallback. */
export function createTaskListTaskInfo(taskIds: Accessor<string[]>) {
  const tasksQuery = useSoupAstItemsQuery(
    () => ({
      params: {
        expand: true,
        limit: 200,
        sort_method: 'updated_at',
        sort_direction: 'desc',
      },
      body: {
        ...NON_TASK_TARGETS,
        df:
          combine(
            '|',
            taskIds().map((id) => literal('id', id))
          ) ?? literal('id', NIL_UUID),
      },
    }),
    () => ({ enabled: taskIds().length > 0 })
  );

  return createMemo((): Record<string, TaskInfo> => {
    const map: Record<string, TaskInfo> = {};
    if (tasksQuery.isPending) return map;
    for (const entity of tasksQuery.data?.entities ?? []) {
      if (!isTaskEntity(entity)) continue;
      const task = entity as TaskEntityWithProperties;
      map[task.id] = {
        statusOptionId: getTaskStatusOptionId(task) ?? null,
        priorityOptionId: getTaskPriorityOptionId(task) ?? null,
        assigneeIds: getTaskAssigneeIds(task),
        due: getTaskDueDate(task) ?? null,
      };
    }
    return map;
  });
}

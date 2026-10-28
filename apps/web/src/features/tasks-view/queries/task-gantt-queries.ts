import type { GanttGroupMove } from '@app/components/gantt/gantt-group-drag';
import type { TaskEntityWithProperties } from '@entity';
import { toPropertyDefinitionDomain } from '@property/utils/transforms';
import { useListPropertiesQuery } from '@queries/properties/definitions';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import { isTaskBoardMove } from '../core/task-board';
import type { TaskGroupBy } from '../types';
import {
  taskBoardMoveValue,
  taskBoardPropertyId,
  toBoardTask,
} from './task-board';
import type { TasksDataSourceItem } from './use-tasks-query';

/** Leaves authorization to property saves, matching task-list editing. */
export function createTaskGanttQueries(options: {
  rows: Accessor<readonly TasksDataSourceItem[]>;
  grouping: Accessor<TaskGroupBy>;
  projectsEnabled: Accessor<boolean>;
}) {
  const grouping = () => {
    const group = options.grouping();
    return group === 'none' ||
      group === 'date' ||
      (group === 'project' && !options.projectsEnabled())
      ? undefined
      : group;
  };
  const tasks = createMemo(() => {
    const result = new Map<string, TaskEntityWithProperties>();
    for (const row of options.rows()) {
      if (row.kind === 'entity') result.set(row.entity.id, row.entity);
    }
    return result;
  });
  const definitions = useListPropertiesQuery(
    () => ({ scope: 'system', includeOptions: true }),
    () => !!grouping()
  );
  const groupProperty = createMemo(() => {
    const group = grouping();
    if (!group || !definitions.isSuccess) return;
    const item = definitions.data.find(
      (item) =>
        ('definition' in item ? item.definition : item).id ===
        taskBoardPropertyId(group)
    );
    if (!item) return;
    const property = toPropertyDefinitionDomain(
      'definition' in item ? item.definition : item,
      'property_options' in item ? item.property_options : []
    );
    const expected =
      group === 'status' || group === 'priority' ? 'SELECT_STRING' : 'ENTITY';
    return property.isSystem &&
      property.owner.scope === 'system' &&
      !property.isMetadata &&
      (!property.specificEntityType ||
        property.specificEntityType === 'TASK') &&
      property.valueType === expected
      ? property
      : undefined;
  });
  const destinations = createMemo(() =>
    options
      .rows()
      .flatMap((row) => (row.kind === 'group-header' ? [row.groupId] : []))
  );
  const [saving, setSaving] = createSignal<string[]>([]);
  const save = useBulkSaveEntityPropertiesMutation();
  const canDrag = (id: string) =>
    tasks().has(id) && !saving().includes(id) && !!groupProperty();

  const resolveMove = (move: GanttGroupMove) => {
    const group = grouping();
    const property = groupProperty();
    const task = tasks().get(move.id);
    if (
      !group ||
      !property ||
      !task ||
      !canDrag(move.id) ||
      !destinations().includes(move.toGroup)
    )
      return;
    const boardTask = toBoardTask(task);
    const boardMove = {
      id: move.id,
      fromLane: move.fromGroup,
      toLane: move.toGroup,
    };
    if (!isTaskBoardMove(boardTask, group, boardMove)) return;
    if (
      group === 'assignee' &&
      !move.toGroup &&
      boardTask.assigneeIds.some((id) => id !== move.fromGroup)
    )
      return;
    if (
      (group === 'status' || group === 'priority') &&
      !(
        (!move.toGroup && group === 'priority') ||
        property.options?.some((option) => option.id === move.toGroup)
      )
    )
      return;
    return { group, property, task, boardMove };
  };

  return {
    canDrag,
    canMove: (move: GanttGroupMove) => !!resolveMove(move),
    async moveGroup(move: GanttGroupMove) {
      const resolved = resolveMove(move);
      if (!resolved)
        throw new Error('Task or destination is no longer editable');
      const { task, group, property, boardMove } = resolved;
      setSaving((ids) => [...ids, move.id]);
      try {
        await save.mutateAsync({
          properties: [
            {
              entityId: move.id,
              entityType: 'TASK',
              property,
              apiValues: taskBoardMoveValue(task, group, boardMove),
            },
          ],
        });
      } finally {
        setSaving((ids) => ids.filter((id) => id !== move.id));
      }
    },
  };
}

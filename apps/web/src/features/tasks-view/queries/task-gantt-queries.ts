import type { GanttGroupMove } from '@app/components/gantt/gantt-group-drag';
import { canEditProject } from '@app/features/projects/core/project';
import { projectDetailQueryOptions } from '@app/features/projects/queries/project-identity';
import { toast } from '@core/component/Toast/Toast';
import type { TaskEntityWithProperties } from '@entity';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type {
  PropertyApiValues,
  PropertyDefinitionDomain,
} from '@property/types';
import { toPropertyDefinitionDomain } from '@property/utils/transforms';
import { useListPropertiesQuery } from '@queries/properties/definitions';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { useDocumentAccessLevelsQuery } from '@queries/storage/document-metadata';
import { initiativeClient } from '@service-storage/initiative';
import { useQueries } from '@tanstack/solid-query';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import { isTaskBoardMove } from '../core/task-board';
import type { TaskGroupBy } from '../types';
import {
  taskBoardMoveValue,
  taskBoardPropertyId,
  toBoardTask,
} from './task-board';
import type { TasksDataSourceItem } from './use-tasks-query';

/** One permission and definition source serves both timeline resizing and group moves. */
export function createTaskGanttQueries(options: {
  rows: Accessor<readonly TasksDataSourceItem[]>;
  grouping: Accessor<TaskGroupBy>;
  userId: Accessor<string | undefined>;
  projectsEnabled: Accessor<boolean>;
}) {
  const tasks = createMemo(() => {
    const result = new Map<string, TaskEntityWithProperties>();
    for (const row of options.rows()) {
      if (row.kind === 'entity') result.set(row.entity.id, row.entity);
    }
    return result;
  });
  const permissions = useDocumentAccessLevelsQuery(() => [...tasks().keys()]);
  const definitions = useListPropertiesQuery(() => ({
    scope: 'system',
    includeOptions: true,
  }));
  const properties = createMemo(
    () =>
      new Map(
        (definitions.isSuccess ? definitions.data : [])
          .map((item) => {
            const definition = 'definition' in item ? item.definition : item;
            const property = toPropertyDefinitionDomain(
              definition,
              'property_options' in item ? item.property_options : []
            );
            return [definition.id, property] as const;
          })
          .filter(
            ([, property]) =>
              property.isSystem &&
              property.owner.scope === 'system' &&
              !property.isMetadata &&
              (!property.specificEntityType ||
                property.specificEntityType === 'TASK')
          )
      )
  );
  const grouping = () => {
    const group = options.grouping();
    return group === 'none' || group === 'date' ? undefined : group;
  };
  const groupProperty = () => {
    const group = grouping();
    if (!group) return;
    const property = properties().get(taskBoardPropertyId(group));
    const expected =
      group === 'status' || group === 'priority' ? 'SELECT_STRING' : 'ENTITY';
    return property?.valueType === expected ? property : undefined;
  };
  const dueDate = () => {
    const property = properties().get(SYSTEM_PROPERTY_IDS.DUE_DATE);
    return property?.valueType === 'DATE' ? property : undefined;
  };
  const destinationIds = createMemo(() => {
    if (grouping() !== 'project' || !options.projectsEnabled()) return [];
    return [
      ...new Set(
        options
          .rows()
          .flatMap((row) =>
            row.kind === 'group-header' && row.groupId ? [row.groupId] : []
          )
      ),
    ];
  });
  const projects = useQueries(() => ({
    queries: destinationIds().map((id) => ({
      ...projectDetailQueryOptions(initiativeClient, options.userId(), id),
      enabled: !!options.userId(),
    })),
  }));
  const [saving, setSaving] = createSignal<ReadonlySet<string>>(new Set());
  const save = useBulkSaveEntityPropertiesMutation();
  const canEditTask = (id: string) =>
    tasks().has(id) &&
    !saving().has(id) &&
    permissions.some(
      (query) =>
        query.isSuccess &&
        query.data.documentId === id &&
        (query.data.accessLevel === 'edit' ||
          query.data.accessLevel === 'owner')
    );
  const canMove = (move: GanttGroupMove) => {
    const group = grouping();
    const property = groupProperty();
    const task = tasks().get(move.id);
    if (!group || !property || !task || !canEditTask(move.id)) return false;
    if (
      !options
        .rows()
        .some(
          (row) => row.kind === 'group-header' && row.groupId === move.toGroup
        )
    )
      return false;
    if (
      !isTaskBoardMove(toBoardTask(task), group, {
        id: move.id,
        fromLane: move.fromGroup,
        toLane: move.toGroup,
      })
    )
      return false;
    if (group === 'status' || group === 'priority') {
      return (
        (!move.toGroup && group === 'priority') ||
        !!property.options?.some((option) => option.id === move.toGroup)
      );
    }
    if (group !== 'project') return true;
    if (!options.projectsEnabled()) return false;
    return (
      !move.toGroup ||
      projects.some(
        (query) =>
          query.isSuccess &&
          query.data.project.id === move.toGroup &&
          canEditProject(query.data.project)
      )
    );
  };
  const persist = async (
    id: string,
    property: PropertyDefinitionDomain,
    apiValues: PropertyApiValues
  ) => {
    setSaving((ids) => new Set([...ids, id]));
    try {
      await save.mutateAsync({
        properties: [{ entityId: id, entityType: 'TASK', property, apiValues }],
      });
    } finally {
      setSaving((ids) => new Set([...ids].filter((current) => current !== id)));
    }
  };

  return {
    canEdit: (id: string) => canEditTask(id) && !!dueDate(),
    canDrag: (id: string) => canEditTask(id) && !!groupProperty(),
    canMove,
    async moveGroup(move: GanttGroupMove) {
      const group = grouping();
      const property = groupProperty();
      const task = tasks().get(move.id);
      if (!canMove(move) || !group || !property || !task)
        throw new Error('Task or destination is no longer editable');
      await persist(
        move.id,
        property,
        taskBoardMoveValue(task, group, {
          id: move.id,
          fromLane: move.fromGroup,
          toLane: move.toGroup,
        })
      );
    },
    async saveEnd(id: string, date: Date) {
      const property = dueDate();
      if (!canEditTask(id) || !property || !Number.isFinite(date.getTime())) {
        toast.failure('Failed to save due date');
        throw new Error('Task due date is no longer editable');
      }
      await persist(id, property, { valueType: 'DATE', value: date });
    },
  };
}

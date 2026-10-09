import { canEditProject } from '@app/features/projects/core/project';
import { createProjectDetailQuery } from '@app/features/projects/queries/project-identity';
import { toProjectDetail } from '@app/features/projects/queries/project-model';
import type { FacetSelection, SortSelection } from '@app/features/soup';
import { sortItems } from '@app/features/soup/collection/transforms';
import { throwOnErr } from '@core/util/result';
import { soupPropertyToProperty } from '@entity/extractors-property/property-helpers';
import type { TaskEntityWithProperties } from '@entity/types/entity';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { Property, PropertyApiValues } from '@property/types';
import { toPropertyDefinitionDomain } from '@property/utils/transforms';
import { useListPropertiesQuery } from '@queries/properties/definitions';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { useDocumentAccessLevelsQuery } from '@queries/storage/document-metadata';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { initiativeClient } from '@service-storage/initiative';
import { type Accessor, createMemo, createSignal, mapArray } from 'solid-js';
import { TASK_SORT_DEFINITIONS } from '../constants';
import type { TaskBoardActions } from '../context/task-board';
import type { TaskBoardColumn, TaskBoardGrouping } from '../core/task-board';
import type { TaskSortId } from '../types';
import {
  filterTaskBoardColumns,
  taskBoardColumns,
  taskBoardMoveValue,
  taskBoardPropertyId,
  toBoardTask,
} from './task-board';
import type { TasksDataSourceItem } from './use-tasks-query';

/** Adapts shared query caches to the board's narrow read/write capabilities. */
export function createTaskBoardQueries(options: {
  rows: Accessor<readonly TasksDataSourceItem[]>;
  grouping: Accessor<TaskBoardGrouping>;
  searching: Accessor<boolean>;
  userId: Accessor<string | undefined>;
  projectsEnabled: Accessor<boolean>;
  facets?: Accessor<FacetSelection>;
  sort?: Accessor<SortSelection<TaskSortId>[]>;
}) {
  const [propertySaving, setPropertySaving] = createSignal<ReadonlySet<string>>(
    new Set()
  );

  const entities = createMemo(() => {
    const result = new Map<string, TaskEntityWithProperties>();

    for (const row of options.rows()) {
      if (row.kind !== 'entity') {
        continue;
      }

      result.set(row.entity.id, row.entity);
    }

    return result;
  });

  const ranks = createMemo(() => {
    const values = [...entities().values()];
    const ordered = options.searching()
      ? values
      : sortItems(
          values,
          options.sort?.() ?? [{ id: 'updated_at' }],
          TASK_SORT_DEFINITIONS
        );

    return new Map(ordered.map((entity, index) => [entity.id, index]));
  });

  const ids = createMemo(() => [...entities().keys()]);
  const permissions = useDocumentAccessLevelsQuery(ids);
  const editableTasks = createMemo(() => {
    const editableIds = permissions.flatMap((query) => {
      if (!query.isSuccess) {
        return [];
      }

      const { documentId, accessLevel } = query.data;
      const canEdit = accessLevel === 'edit' || accessLevel === 'owner';

      return canEdit ? [documentId] : [];
    });

    return new Set(editableIds);
  });

  const definitions = useListPropertiesQuery(() => ({
    scope: 'system',
    includeOptions: true,
  }));
  const properties = createMemo(() => {
    const available = definitions.isSuccess ? definitions.data : [];

    return new Map(
      available.map((item) => {
        const definition = 'definition' in item ? item.definition : item;
        const propertyOptions =
          'property_options' in item ? item.property_options : [];
        const property = toPropertyDefinitionDomain(
          definition,
          propertyOptions
        );

        return [definition.id, property];
      })
    );
  });

  const allColumns = createMemo(() =>
    taskBoardColumns(options.rows(), options.grouping(), options.searching())
  );
  const rawColumns = createMemo(() =>
    filterTaskBoardColumns(
      allColumns(),
      options.grouping(),
      options.facets?.() ?? {}
    )
  );

  const projectIds = createMemo(() => {
    if (options.grouping() !== 'project' || !options.projectsEnabled()) {
      return [];
    }

    return rawColumns().flatMap((column) => (column.id ? [column.id] : []));
  });

  const projects = mapArray(projectIds, (id) =>
    createProjectDetailQuery(getGraphqlSoupClient, options.userId, () => id)
  );

  const projectMap = createMemo(() => {
    const entries = projects().flatMap((query) => {
      const project = query.isSuccess ? query.data?.project : undefined;

      return project ? [[project.id, project] as const] : [];
    });

    return new Map(entries);
  });

  const columnLabel = (column: TaskBoardColumn) => {
    if (!column.id) {
      return column.label;
    }

    if (options.grouping() === 'project') {
      return projectMap().get(column.id)?.name ?? 'Unavailable project';
    }

    return column.label;
  };

  const columns = createMemo(() => {
    return rawColumns().map((column) => ({
      ...column,
      label: columnLabel(column),
    }));
  });

  const save = useBulkSaveEntityPropertiesMutation();

  const actions: TaskBoardActions = {
    canEditTask(id) {
      if (!entities().has(id) || !editableTasks().has(id)) {
        return false;
      }

      return !propertySaving().has(id);
    },
    canMoveTo(grouping, id) {
      const property = properties().get(taskBoardPropertyId(grouping));

      if (!property) {
        return false;
      }

      if (grouping === 'status') {
        return !!id && !!property.options?.some((option) => option.id === id);
      }

      if (grouping === 'priority') {
        return !id || !!property.options?.some((option) => option.id === id);
      }

      if (grouping !== 'project') {
        return true;
      }

      if (!options.projectsEnabled()) {
        return false;
      }

      if (!id) {
        return true;
      }

      const project = projectMap().get(id);

      return !!project && canEditProject(project);
    },
    async save(move, grouping) {
      const entity = entities().get(move.id);
      const property = properties().get(taskBoardPropertyId(grouping));

      if (!entity || !property) {
        throw new Error('Task or destination is no longer editable');
      }

      const canEdit = actions.canEditTask(move.id);
      const canMove = canEdit && actions.canMoveTo(grouping, move.toLane);

      if (!canMove) {
        throw new Error('Task or destination is no longer editable');
      }

      await save.mutateAsync({
        properties: [
          {
            entityId: entity.id,
            entityType: 'TASK',
            property,
            apiValues: taskBoardMoveValue(entity, grouping, move),
          },
        ],
      });
    },
  };

  const property = (id: string, definitionId: string): Property | undefined => {
    const entity = entities().get(id);

    if (!entity) {
      return undefined;
    }

    const definition = properties().get(definitionId);
    const existing = entity.properties?.find(
      (item) => item.definition.id === definitionId
    );

    if (existing) {
      const value = soupPropertyToProperty(existing);

      return { ...value, options: definition?.options ?? value.options };
    }

    if (!definition || definition.valueType === 'TAG') {
      return undefined;
    }

    return {
      propertyId: `${id}:${definitionId}`,
      propertyDefinitionId: definitionId,
      displayName: definition.displayName,
      isMultiSelect: definition.isMultiSelect,
      isMetadata: definition.isMetadata,
      isSystemProperty: definition.isSystem,
      isRequired: definitionId === SYSTEM_PROPERTY_IDS.STATUS,
      owner: definition.owner,
      specificEntityType: definition.specificEntityType,
      createdAt: definition.createdAt,
      updatedAt: definition.updatedAt,
      options: definition.options,
      valueType: definition.valueType,
      value: null,
    };
  };

  const saveProperty = async (
    id: string,
    value: Property,
    apiValues: PropertyApiValues
  ) => {
    const definition = properties().get(value.propertyDefinitionId);

    if (!actions.canEditTask(id) || !definition || definition.isMetadata) {
      throw new Error('Task is no longer editable');
    }

    setPropertySaving((ids) => new Set([...ids, id]));

    try {
      if (definition.id === SYSTEM_PROPERTY_IDS.PROJECT) {
        if (!options.projectsEnabled() || apiValues.valueType !== 'ENTITY') {
          throw new Error('Project editing is unavailable');
        }

        for (const ref of apiValues.refs ?? []) {
          // A project column already holds this project's live detail.
          const project =
            projectMap().get(ref.entity_id) ??
            toProjectDetail(
              await throwOnErr(() => initiativeClient.get(ref.entity_id))
            );

          if (!canEditProject(project)) {
            throw new Error('Project is not editable');
          }
        }
      }

      if (!entities().has(id) || !editableTasks().has(id)) {
        throw new Error('Task is no longer editable');
      }

      await save.mutateAsync({
        properties: [
          { entityId: id, entityType: 'TASK', property: definition, apiValues },
        ],
      });
    } finally {
      setPropertySaving(
        (ids) => new Set([...ids].filter((pendingId) => pendingId !== id))
      );
    }
  };

  return {
    actions,
    columns,
    compareTasks: (left: string, right: string) =>
      (ranks().get(left) ?? Infinity) - (ranks().get(right) ?? Infinity),
    hiddenColumnCount: () => allColumns().length - rawColumns().length,
    task: (id: string) => {
      const entity = entities().get(id);

      return entity ? toBoardTask(entity) : undefined;
    },
    entity: (id: string) => entities().get(id),
    property,
    saveProperty,
    canEditProperty: (id: string, definitionId: string) => {
      const definition = properties().get(definitionId);

      if (!actions.canEditTask(id) || !definition) {
        return false;
      }

      return !definition.isMetadata;
    },
    definitionError: () => definitions.isError,
    retryDefinitions: async () => {
      await definitions.refetch();
    },
  };
}

import { PROPERTY_OPTION_IDS } from '@property/identifiers';
import type { PropertyApiValues } from '@property/types';
import { match } from 'ts-pattern';
import type { TaskComposerContext } from '../task-composer/core/context';
import type { TaskBoardGrouping } from './core/task-board';
import { taskBoardPropertyId } from './queries/task-board';

/** Keep host presets while selecting the originating board column. */
export function taskBoardComposerContext(options: {
  grouping: TaskBoardGrouping;
  columnId: string;
  scopeKey?: string;
  context?: TaskComposerContext;
}): TaskComposerContext {
  const { grouping, columnId, context } = options;
  const propertyId = taskBoardPropertyId(grouping);
  const value = match(grouping)
    .returnType<PropertyApiValues>()
    .with('status', () => ({
      valueType: 'SELECT_STRING',
      values: [columnId || PROPERTY_OPTION_IDS.STATUS.NOT_STARTED],
    }))
    .with('priority', () => ({
      valueType: 'SELECT_STRING',
      values: columnId ? [columnId] : null,
    }))
    .with('assignee', 'project', () => ({
      valueType: 'ENTITY',
      refs: columnId
        ? [
            {
              entity_id: columnId,
              entity_type: grouping === 'project' ? 'INITIATIVE' : 'USER',
            },
          ]
        : null,
    }))
    .exhaustive();

  return {
    key: JSON.stringify([
      'tasks-board',
      options.scopeKey,
      context?.key,
      grouping,
      columnId,
    ]),
    visiblePropertyIds: context?.visiblePropertyIds
      ? [...new Set([...context.visiblePropertyIds, propertyId])]
      : undefined,
    initialPropertyValues: {
      ...context?.initialPropertyValues,
      [propertyId]: value,
    },
  };
}

import {
  buildGroupedSoupRows,
  isSoupRowVisible,
} from '@app/features/soup/collection/rows';
import type { SoupGroup } from '@app/features/soup/collection/types';
import type { Property } from '@property/types';
import { type Accessor, createMemo } from 'solid-js';
import type {
  ProjectListEntity,
  ProjectListGroupBy,
  ProjectListItem,
} from './project-collection';

/** Gantt-only destinations; the ordinary list keeps its existing loaded groups. */
export function createProjectGanttRows(options: {
  grouping: Accessor<ProjectListGroupBy>;
  groups: Accessor<readonly SoupGroup<ProjectListEntity>[]>;
  items: Accessor<readonly ProjectListItem[]>;
  property: Accessor<Property | undefined>;
  scope: Accessor<string>;
  isExpanded: (id: string) => boolean;
}) {
  // Remember assignees seen in this scope, including a group emptied by a move.
  const assignees = createMemo<{ scope: string; ids: string[] }>((previous) => {
    const scope = options.scope();
    const ids =
      options.grouping() === 'assignee'
        ? [
            ...new Set([
              ...(previous?.scope === scope ? previous.ids : []),
              ...options
                .groups()
                .map((group) => group.id)
                .filter(Boolean),
            ]),
          ]
        : [];
    return { scope, ids };
  });
  const groups = createMemo<SoupGroup<ProjectListEntity>[]>(() => {
    const grouping = options.grouping();
    if (grouping === 'none') return [];
    const current = new Map(options.groups().map((group) => [group.id, group]));
    const add = (id: string, label: string) => {
      if (!current.has(id))
        current.set(id, { id, label, count: 0, entities: [] });
    };
    const property = options.property();
    if (grouping === 'assignee') {
      for (const id of assignees().ids) add(id, id);
    } else if (property?.valueType === 'SELECT_STRING') {
      for (const option of property.options ?? []) {
        if (option.value.type === 'string') add(option.id, option.value.value);
      }
    }
    if (!property?.isRequired) {
      add('', grouping === 'assignee' ? 'Unassigned' : `No ${grouping}`);
    }
    return [...current.values()];
  });
  const items = createMemo<ProjectListItem[]>(() => {
    const current = options.items();
    if (options.grouping() === 'none') return [...current];
    return [
      ...buildGroupedSoupRows(groups()).filter((row) =>
        isSoupRowVisible(row, options.isExpanded)
      ),
      ...current.filter(
        (row) => row.kind === 'load-more' && row.groupId === undefined
      ),
    ];
  });
  return { groups, items };
}

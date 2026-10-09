import { ganttGroupPlacement } from '@app/components/gantt/gantt-group-placement';
import {
  buildGroupedSoupRows,
  createSoupLoadMoreRow,
  isSoupRowVisible,
} from '@app/features/soup/collection/rows';
import type { SoupGroup } from '@app/features/soup/collection/types';
import type { Property } from '@property/types';
import { createRoot, createSignal } from 'solid-js';
import { expect, it } from 'vitest';
import type {
  ProjectListEntity,
  ProjectListGroupBy,
} from './project-collection';
import { createProjectGanttRows } from './project-gantt-rows';

const entity: ProjectListEntity = {
  id: 'project',
  type: 'initiative',
  project: { id: 'project', name: 'Project', updatedAt: '' },
  properties: [],
};
const property: Property = {
  propertyId: 'status',
  propertyDefinitionId: 'status',
  displayName: 'Status',
  valueType: 'SELECT_STRING',
  value: null,
  isMultiSelect: false,
  owner: { scope: 'system' },
  createdAt: '',
  updatedAt: '',
  options: ['active', 'empty'].map((id, index) => ({
    id,
    property_definition_id: 'status',
    value: { type: 'string', value: id },
    display_order: index,
    color: null,
    created_at: '',
    updated_at: '',
  })),
};
function setup(grouping: ProjectListGroupBy) {
  const [groupBy, setGroupBy] = createSignal(grouping);
  const [groups, setGroups] = createSignal<SoupGroup<ProjectListEntity>[]>([
    { id: 'active', label: 'Active', count: 1, entities: [entity] },
  ]);
  const [definition, setDefinition] = createSignal<Property | undefined>(
    property
  );
  const [scope, setScope] = createSignal('first');
  const [collapsed, setCollapsed] = createSignal(new Set<string>());
  const isExpanded = (id: string) => !collapsed().has(id);
  const continuation = createSoupLoadMoreRow({ scopeId: 'projects' });
  const items = () => [
    ...buildGroupedSoupRows(groups()).filter((row) =>
      isSoupRowVisible(row, isExpanded)
    ),
    continuation,
  ];
  const gantt = createProjectGanttRows({
    grouping: groupBy,
    groups,
    items,
    property: definition,
    scope,
    isExpanded,
  });
  return {
    gantt,
    items,
    setGroups,
    setDefinition,
    setScope,
    setCollapsed,
    setGroupBy,
    continuation,
  };
}

it.each(['status', 'priority'] as const)(
  'provides empty %s destinations and a valid ghost index without changing the list',
  (grouping) =>
    createRoot((dispose) => {
      const source = setup(grouping);
      const before = source.items();
      expect(
        source.gantt.groups().map((group) => [group.id, group.count])
      ).toEqual([
        ['active', 1],
        ['empty', 0],
        ['', 0],
      ]);
      const rows = source.gantt.items();
      const placement = ganttGroupPlacement({
        items: rows,
        move: { id: 'project', fromGroup: 'active', toGroup: 'empty' },
        getEntity: (row) => (row.kind === 'entity' ? row.entity : undefined),
        getGroup: (row) =>
          row.kind === 'section-header' ? undefined : row.groupId,
        compare: () => 0,
      });
      expect(placement).toEqual({
        index:
          rows.findIndex(
            (row) => row.kind === 'group-header' && row.groupId === 'empty'
          ) + 1,
      });
      expect(source.items()).toEqual(before);
      expect(rows.at(-1)).toBe(source.continuation);
      expect(rows.filter((row) => row.kind === 'load-more')).toHaveLength(1);
      source.setDefinition({ ...property, isRequired: true });
      expect(source.gantt.groups().some((group) => !group.id)).toBe(false);
      dispose();
    })
);

it('retains an emptied assignee group within its scope but forgets assignees across scope changes', () => {
  createRoot((dispose) => {
    const source = setup('assignee');
    expect(source.gantt.groups().map((group) => group.id)).toEqual([
      'active',
      '',
    ]);
    source.setGroups([]);
    expect(source.gantt.groups()).toEqual([
      { id: 'active', label: 'active', count: 0, entities: [] },
      { id: '', label: 'Unassigned', count: 0, entities: [] },
    ]);
    source.setScope('different-user-or-filters');
    expect(source.gantt.groups().map((group) => group.id)).toEqual(['']);
    dispose();
  });
});

it('keeps collapsed destinations visible and uses the original rows when ungrouped', () => {
  createRoot((dispose) => {
    const source = setup('status');
    source.setCollapsed(new Set(['active', 'empty']));
    expect(source.gantt.items().filter((row) => row.kind === 'entity')).toEqual(
      []
    );
    expect(
      source.gantt
        .items()
        .filter((row) => row.kind === 'group-header')
        .map((row) => row.groupId)
    ).toEqual(['active', 'empty', '']);
    source.setGroupBy('none');
    expect(source.gantt.items()).toEqual(source.items());
    expect(source.gantt.groups()).toEqual([]);
    dispose();
  });
});

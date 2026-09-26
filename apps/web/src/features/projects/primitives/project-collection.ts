import { createDisclosureState } from '@app/components/list/create-disclosure-state';
import { createListController } from '@app/components/list/create-list-controller';
import {
  buildFlatSoupRows,
  buildGroupedSoupRows,
  createSoupLoadMoreRow,
  isSoupRowVisible,
} from '@app/features/soup/collection/rows';
import {
  deduplicateItems,
  groupSoupEntities,
} from '@app/features/soup/collection/transforms';
import type { SoupRow } from '@app/features/soup/collection/types';
import { debouncedDependent } from '@core/util/debounce';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import type { ProjectRow, ProjectsContext } from '../context/projects-context';
import type { ProjectFilters } from '../core/project';

export type ProjectListEntity = ProjectRow & {
  id: string;
  type: 'initiative';
  assigneeGroup?: string;
};
export type ProjectListItem = SoupRow<ProjectListEntity>;
export type ProjectListGroupBy = 'none' | 'status' | 'priority' | 'assignee';
export type ProjectListActivation = { event?: MouseEvent; newSplit?: boolean };

export type ProjectCollectionSnapshot = {
  search: string;
  status: string;
  priority: string;
  dueBefore: string;
  dueAfter: string;
  mine: boolean;
  sort: NonNullable<ProjectFilters['sort']>;
  groupBy: ProjectListGroupBy;
  scrollOffset: number;
  collapsedGroupIds: string[];
  focusKey?: string;
};

export type ProjectsViewState =
  | { kind: 'loading' }
  | { kind: 'error'; error: Error }
  | { kind: 'ready'; rows: readonly ProjectRow[]; backgroundError?: Error };

export function createProjectCollection(capabilities: {
  createSource: ProjectsContext['createCollectionSource'];
  userId: Accessor<string | undefined>;
  onOpen?: (id: string, metadata?: ProjectListActivation) => void;
  initialState?: ProjectCollectionSnapshot;
  captureState?: (read: Accessor<ProjectCollectionSnapshot>) => void;
}) {
  const initial = capabilities.initialState;
  const [search, setSearch] = createSignal(initial?.search ?? '');
  const query = debouncedDependent(search, 150);
  const [status, setStatus] = createSignal(initial?.status ?? '');
  const [priority, setPriority] = createSignal(initial?.priority ?? '');
  const [dueBefore, setDueBefore] = createSignal(initial?.dueBefore ?? '');
  const [dueAfter, setDueAfter] = createSignal(initial?.dueAfter ?? '');
  const [mine, setMine] = createSignal(initial?.mine ?? false);
  const [sort, setSort] = createSignal<NonNullable<ProjectFilters['sort']>>(
    initial?.sort ?? 'updated'
  );
  const [groupBy, setGroupBy] = createSignal<ProjectListGroupBy>(
    initial?.groupBy ?? 'status'
  );
  const [scrollOffset, setScrollOffset] = createSignal(
    initial?.scrollOffset ?? 0
  );
  const disclosure = createDisclosureState({
    defaultExpanded: true,
    initialToggledKeys: initial?.collapsedGroupIds,
  });
  const source = capabilities.createSource(() => ({
    query: query().trim() || undefined,
    status: status() || undefined,
    priority: priority() || undefined,
    dueBefore: dueBefore()
      ? new Date(`${dueBefore()}T23:59:59.999`).toISOString()
      : undefined,
    dueAfter: dueAfter()
      ? new Date(`${dueAfter()}T00:00:00`).toISOString()
      : undefined,
    assignee: mine() ? capabilities.userId() : undefined,
    sort: sort(),
    descending: sort() === 'updated',
  }));
  const state = createMemo((): ProjectsViewState => {
    const rows = source.rows();
    if (rows === undefined) {
      const error = source.error();
      if (error) return { kind: 'error', error };
      return { kind: 'loading' };
    }
    return {
      kind: 'ready',
      rows,
      backgroundError: source.error(),
    };
  });
  const entities = (): ProjectListEntity[] => {
    const current = state();
    return current.kind === 'ready'
      ? deduplicateItems([...current.rows], {
          getKey: (row) => row.project.id,
          resolveConflict: (_, latest) => latest,
        }).map((row) => ({
          ...row,
          id: row.project.id,
          type: 'initiative',
        }))
      : [];
  };
  const groupProperty = (row: ProjectRow) =>
    row.properties.find(
      (property) =>
        property.propertyDefinitionId ===
        (groupBy() === 'priority'
          ? SYSTEM_PROPERTY_IDS.PRIORITY
          : groupBy() === 'assignee'
            ? SYSTEM_PROPERTY_IDS.ASSIGNEES
            : SYSTEM_PROPERTY_IDS.STATUS)
    );
  const groups = createMemo(() =>
    groupSoupEntities(
      groupBy() === 'assignee'
        ? entities().flatMap((row) => {
            const property = groupProperty(row);
            const ids =
              property?.valueType === 'ENTITY'
                ? (property.value
                    ?.filter((ref) => ref.entity_type === 'USER')
                    .map((ref) => ref.entity_id) ?? [])
                : [];
            return (ids.length ? [...new Set(ids)] : ['']).map(
              (assigneeGroup) => ({ ...row, assigneeGroup })
            );
          })
        : entities(),
      {
        getGroupId: (row) => {
          const property = groupProperty(row);
          if (property?.valueType === 'SELECT_STRING')
            return property.value?.[0] ?? '';
          if (groupBy() === 'assignee') return row.assigneeGroup ?? '';
          return '';
        },
        getGroupLabel: (id, row) => {
          if (!id)
            return groupBy() === 'assignee' ? 'Unassigned' : `No ${groupBy()}`;
          const option = groupProperty(row)?.options?.find(
            (option) => option.id === id
          );
          return option?.value.type === 'string' ? option.value.value : id;
        },
      }
    )
  );
  const items = createMemo<ProjectListItem[]>(() => {
    const rows =
      groupBy() === 'none'
        ? buildFlatSoupRows(entities())
        : buildGroupedSoupRows(groups());
    const visible = rows.filter((row) =>
      isSoupRowVisible(row, disclosure.isExpanded)
    );
    if (source.hasMore())
      visible.push(
        createSoupLoadMoreRow({
          scopeId: 'initiatives',
          label: 'Load more projects',
          isLoading: source.loadingMore(),
        })
      );
    return visible;
  });
  const list = createListController<ProjectListItem, ProjectListActivation>({
    items,
    initialFocusKey: initial?.focusKey,
    getKey: (row) => row.id,
    selection: {
      getKey: (row) => (row.kind === 'entity' ? row.entity.id : row.id),
    },
    isNavigable: (row) => row.kind !== 'section-header',
    isSelectable: (row) => row.kind === 'entity',
    onActivate: ({ item, metadata }) => {
      if (item.kind === 'group-header') disclosure.toggle(item.groupId);
      else if (item.kind === 'load-more') void source.loadMore();
      else if (item.kind === 'entity')
        capabilities.onOpen?.(item.entity.id, metadata);
    },
  });
  capabilities.captureState?.(() => ({
    search: search(),
    status: status(),
    priority: priority(),
    dueBefore: dueBefore(),
    dueAfter: dueAfter(),
    mine: mine(),
    sort: sort(),
    groupBy: groupBy(),
    scrollOffset: scrollOffset(),
    collapsedGroupIds: [...disclosure.toggledKeys()],
    focusKey: list.focus.key(),
  }));
  return {
    state,
    search,
    setSearch,
    status,
    setStatus,
    priority,
    setPriority,
    dueBefore,
    setDueBefore,
    dueAfter,
    setDueAfter,
    mine,
    setMine,
    sort,
    setSort,
    groupBy,
    setGroupBy,
    groups,
    items,
    list,
    disclosure,
    scrollOffset,
    setScrollOffset,
    refresh: source.refresh,
    hasMore: source.hasMore,
    loadMore: source.loadMore,
    loadingMore: source.loadingMore,
  };
}

import { deduplicateSoupEntities } from './transforms';
import type {
  SoupEntityIdentity,
  SoupEntityRow,
  SoupGroup,
  SoupGroupHeaderRow,
  SoupLoadMoreRow,
  SoupRow,
  SoupSectionHeaderRow,
} from './types';

const encodeRowIdSegment = (value: string | undefined) =>
  value === undefined ? 'u' : `s${value.length}:${value}`;

const createSoupRowId = (
  kind: SoupRow['kind'],
  ...segments: (string | undefined)[]
): string =>
  ['soup-row', kind, ...segments]
    .map((segment) => encodeRowIdSegment(segment))
    .join('|');

export type CreateSoupEntityRowOptions = {
  groupId?: string;
  occurrenceId?: string;
};

export function createSoupEntityRow<TEntity extends SoupEntityIdentity>(
  entity: TEntity,
  options: CreateSoupEntityRowOptions = {}
): SoupEntityRow<TEntity> {
  return {
    kind: 'entity',
    id: createSoupRowId(
      'entity',
      entity.type,
      entity.id,
      options.groupId,
      options.occurrenceId
    ),
    entity,
    ...(options.groupId === undefined ? {} : { groupId: options.groupId }),
    ...(options.occurrenceId === undefined
      ? {}
      : { occurrenceId: options.occurrenceId }),
  };
}

export const createSoupGroupHeaderRow = (
  group: Pick<SoupGroup<SoupEntityIdentity>, 'id' | 'label' | 'count'>
): SoupGroupHeaderRow => ({
  kind: 'group-header',
  id: createSoupRowId('group-header', group.id),
  groupId: group.id,
  label: group.label,
  ...(group.count === undefined ? {} : { count: group.count }),
});

export const createSoupSectionHeaderRow = (
  sectionId: string,
  label: string
): SoupSectionHeaderRow => ({
  kind: 'section-header',
  id: createSoupRowId('section-header', sectionId),
  sectionId,
  label,
});

export const createSoupLoadMoreRow = (options: {
  scopeId: string;
  groupId?: string;
  label?: string;
  isLoading?: boolean;
}): SoupLoadMoreRow => ({
  kind: 'load-more',
  id: createSoupRowId('load-more', options.scopeId, options.groupId),
  scopeId: options.scopeId,
  ...(options.groupId === undefined ? {} : { groupId: options.groupId }),
  ...(options.label === undefined ? {} : { label: options.label }),
  ...(options.isLoading === undefined ? {} : { isLoading: options.isLoading }),
});

export type BuildFlatSoupRowsOptions<TEntity extends SoupEntityIdentity> = {
  getOccurrenceId?: (entity: TEntity, index: number) => string | undefined;
};

const nextDuplicateOccurrence = (
  entity: SoupEntityIdentity,
  occurrences: Map<string, number>
) => {
  const key = entity.id;
  const occurrence = occurrences.get(key) ?? 0;
  occurrences.set(key, occurrence + 1);
  return occurrence === 0 ? undefined : `duplicate-${occurrence}`;
};

export function assertUniqueSoupRowIds<TEntity extends SoupEntityIdentity>(
  rows: SoupRow<TEntity>[]
): void {
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) {
      throw new Error(
        `Soup rows must have unique occurrence IDs; received: ${row.id}`
      );
    }
    ids.add(row.id);
  }
}

export function buildFlatSoupRows<TEntity extends SoupEntityIdentity>(
  entities: TEntity[],
  options: BuildFlatSoupRowsOptions<TEntity> = {}
): SoupEntityRow<TEntity>[] {
  const occurrences = new Map<string, number>();
  const rows = entities.map((entity, index) =>
    createSoupEntityRow(entity, {
      occurrenceId:
        options.getOccurrenceId?.(entity, index) ??
        nextDuplicateOccurrence(entity, occurrences),
    })
  );
  assertUniqueSoupRowIds(rows);
  return rows;
}

export type BuildGroupedSoupRowsOptions<TEntity extends SoupEntityIdentity> = {
  getOccurrenceId?: (
    entity: TEntity,
    index: number,
    group: SoupGroup<TEntity>
  ) => string | undefined;
};

export function buildGroupedSoupRows<TEntity extends SoupEntityIdentity>(
  groups: SoupGroup<TEntity>[],
  options: BuildGroupedSoupRowsOptions<TEntity> = {}
): SoupRow<TEntity>[] {
  const groupIds = new Set<string>();
  const rows = groups.flatMap((group) => {
    if (groupIds.has(group.id)) {
      throw new Error(
        `Soup groups must have unique IDs; received: ${group.id}`
      );
    }
    groupIds.add(group.id);

    const groupRows: SoupRow<TEntity>[] = [createSoupGroupHeaderRow(group)];
    const occurrences = new Map<string, number>();
    group.entities.forEach((entity, index) => {
      groupRows.push(
        createSoupEntityRow(entity, {
          groupId: group.id,
          occurrenceId:
            options.getOccurrenceId?.(entity, index, group) ??
            nextDuplicateOccurrence(entity, occurrences),
        })
      );
    });
    if (group.loadMore) {
      groupRows.push(
        createSoupLoadMoreRow({
          ...group.loadMore,
          groupId: group.id,
        })
      );
    }
    return groupRows;
  });
  assertUniqueSoupRowIds(rows);
  return rows;
}

export const getSoupRowEntities = <TEntity extends SoupEntityIdentity>(
  rows: SoupRow<TEntity>[]
): TEntity[] =>
  rows.flatMap((row) => (row.kind === 'entity' ? [row.entity] : []));

export function getUniqueSoupRowEntities<TEntity extends SoupEntityIdentity>(
  rows: SoupRow<TEntity>[]
): TEntity[] {
  return deduplicateSoupEntities(getSoupRowEntities(rows));
}

export const isSoupRowVisible = <TEntity extends SoupEntityIdentity>(
  row: SoupRow<TEntity>,
  isGroupExpanded: (groupId: string) => boolean
): boolean =>
  row.kind === 'entity' || row.kind === 'load-more'
    ? row.groupId === undefined || isGroupExpanded(row.groupId)
    : true;

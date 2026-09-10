import type { EntityData } from '@entity';

export type SoupEntityIdentity = Pick<EntityData, 'id' | 'type'>;

export type SoupEntityRow<TEntity extends SoupEntityIdentity = EntityData> = {
  kind: 'entity';
  /** Rendered occurrence identity; intentionally distinct from `entity.id`. */
  id: string;
  entity: TEntity;
  groupId?: string;
  occurrenceId?: string;
};

export type SoupGroupHeaderRow = {
  kind: 'group-header';
  id: string;
  groupId: string;
  label: string;
  count?: number;
};

export type SoupSectionHeaderRow = {
  kind: 'section-header';
  id: string;
  sectionId: string;
  label: string;
};

export type SoupLoadMoreRow = {
  kind: 'load-more';
  id: string;
  scopeId: string;
  groupId?: string;
  label?: string;
  isLoading?: boolean;
};

export type SoupRow<TEntity extends SoupEntityIdentity = EntityData> =
  | SoupEntityRow<TEntity>
  | SoupGroupHeaderRow
  | SoupSectionHeaderRow
  | SoupLoadMoreRow;

export type SoupGroup<TEntity extends SoupEntityIdentity = EntityData> = {
  id: string;
  label: string;
  entities: TEntity[];
  /** Total server count when it differs from the currently loaded entities. */
  count?: number;
  loadMore?: {
    scopeId: string;
    label?: string;
    isLoading?: boolean;
  };
};

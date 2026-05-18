import type { SoupApiItem } from '@service-storage/generated/schemas';

export type GroupByField =
  | { type: 'date' }
  | { type: 'entity_type' }
  | { type: 'project' }
  | {
      type: 'property';
      propertyDefinitionId: string;
      entityType?: PropertyEntityType;
    };

export type PropertyEntityType =
  | 'CHANNEL'
  | 'CHAT'
  | 'COMPANY'
  | 'DOCUMENT'
  | 'PROJECT'
  | 'TASK'
  | 'THREAD'
  | 'USER';

export interface GroupMeta {
  key: string;
  label: string;
  displayOrder: number | null;
  totalCount: number;
  pageCount: number;
  startIndex: number;
  nextCursor: string | null;
}

export interface GroupedSoupPage {
  items: SoupApiItem[];
  nextCursor: string | null;
  groups: GroupMeta[];
}

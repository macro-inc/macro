export type SortType = 'unread' | 'updated' | 'created' | 'viewed';

export type OwnerType = 'all' | 'me' | 'other';

export type Filters = {
  unreadFilter: boolean;
  sortBy: SortType;
  fileTypeFilter: string[];
  ownerTypeFilter: OwnerType;
};

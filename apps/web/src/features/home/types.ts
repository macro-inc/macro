import type { FacetSelection } from '@app/features/soup/filters/facets/types';

/** Signal and Noise are old Home's; Recent is New Home's list. */
export type HomeTab = 'signal' | 'noise' | 'recent';

export type HomeGroupBy = 'date' | 'type' | 'none';

export type HomeViewState = {
  tab: HomeTab;
  search: string;
  groupBy: HomeGroupBy;
  facets: FacetSelection;
};

export type HomeViewStateOptions = Partial<HomeViewState>;

export type HomeTypeFilter =
  | 'documents'
  | 'tasks'
  | 'email'
  | 'channels'
  | 'agents'
  | 'folders'
  | 'initiatives'
  | 'github'
  | 'calendar';

export type HomeReadFilter = 'unread' | 'read';

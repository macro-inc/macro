import type { FacetSelection } from '@app/features/soup/filters/facets/types';

export type HomeTab = 'signal' | 'noise' | 'reminders';

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
  | 'chats'
  | 'agents'
  | 'projects'
  | 'github'
  | 'reminders'
  | 'calendar';

export type HomeReadFilter = 'unread' | 'read';

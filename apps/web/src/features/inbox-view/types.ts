import type { FacetSelection } from '@app/features/soup/filters/facets/types';

export type InboxTab = 'signal' | 'noise' | 'all' | 'reminders';

export type InboxGroupBy = 'date' | 'type' | 'none';

export type InboxViewState = {
  tab: InboxTab;
  search: string;
  groupBy: InboxGroupBy;
  facets: FacetSelection;
};

export type InboxViewStateOptions = Partial<InboxViewState>;

export type InboxTypeFilter =
  | 'documents'
  | 'tasks'
  | 'email'
  | 'channels'
  | 'agents'
  | 'projects'
  | 'github'
  | 'reminders'
  | 'calendar';

export type InboxReadFilter = 'unread' | 'read';

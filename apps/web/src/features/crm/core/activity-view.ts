import type { FacetSelection } from '../../soup';

/** User-controlled refinements; the CRM association scope is never editable. */
export type CrmActivityViewState = {
  search: string;
  facets: FacetSelection;
  sort: 'updated_at' | 'created_at' | 'viewed_at';
  direction: 'desc' | 'asc';
  groupBy: 'none' | 'date';
};

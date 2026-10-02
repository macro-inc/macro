export type CrmListColumnId = 'stage' | 'owner' | 'revenue';

export type CrmDisplayOptions = {
  /** Visible list columns (order stays fixed; this only hides/shows). */
  listColumns: Record<CrmListColumnId, boolean>;
};

export const DEFAULT_CRM_DISPLAY_OPTIONS: CrmDisplayOptions = {
  listColumns: { stage: true, owner: true, revenue: true },
};

export const CRM_LIST_COLUMN_LABELS: Record<CrmListColumnId, string> = {
  stage: 'Stage',
  owner: 'Owner',
  revenue: 'Revenue',
};

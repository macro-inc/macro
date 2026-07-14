/**
 * Personal display options for the CRM Customers view: which property
 * columns show in the list and which fields show on kanban cards.
 * Persisted per-user (localStorage preference), same mechanism as other
 * sticky view settings.
 */

import { makePersisted } from '@solid-primitives/storage';
import { createSignal } from 'solid-js';

export type CrmListColumnId = 'stage' | 'owner' | 'revenue';
export type CrmKanbanFieldId = 'owner' | 'domain' | 'lastInteraction';

export type CrmDisplayOptions = {
  /** Visible list columns (order stays fixed; this only hides/shows). */
  listColumns: Record<CrmListColumnId, boolean>;
  /** Fields rendered on kanban cards. */
  kanbanFields: Record<CrmKanbanFieldId, boolean>;
};

export const DEFAULT_CRM_DISPLAY_OPTIONS: CrmDisplayOptions = {
  listColumns: { stage: true, owner: true, revenue: true },
  kanbanFields: { owner: true, domain: true, lastInteraction: true },
};

export const CRM_LIST_COLUMN_LABELS: Record<CrmListColumnId, string> = {
  stage: 'Stage',
  owner: 'Owner',
  revenue: 'Revenue',
};

export const CRM_KANBAN_FIELD_LABELS: Record<CrmKanbanFieldId, string> = {
  owner: 'Owner',
  domain: 'Domain',
  lastInteraction: 'Last interaction',
};

// One shared signal for the whole app (module-level), so toggling in the
// Display menu re-renders every consumer (list, kanban) immediately.
// `usePreference` would give each component its own signal that only
// shares the localStorage key — updates would not propagate until reload.
const [displayOptions, setDisplayOptions] = makePersisted(
  createSignal<CrmDisplayOptions>(DEFAULT_CRM_DISPLAY_OPTIONS),
  { name: 'macro:pref:crm:display' }
);

export function useCrmDisplayOptions() {
  const [options, setOptions] = [displayOptions, setDisplayOptions];

  // Merge with defaults so options saved by older builds keep working
  // when new fields are added.
  const merged = (): CrmDisplayOptions => ({
    listColumns: {
      ...DEFAULT_CRM_DISPLAY_OPTIONS.listColumns,
      ...options().listColumns,
    },
    kanbanFields: {
      ...DEFAULT_CRM_DISPLAY_OPTIONS.kanbanFields,
      ...options().kanbanFields,
    },
  });

  const toggleListColumn = (column: CrmListColumnId) => {
    const current = merged();
    setOptions({
      ...current,
      listColumns: {
        ...current.listColumns,
        [column]: !current.listColumns[column],
      },
    });
  };

  const toggleKanbanField = (field: CrmKanbanFieldId) => {
    const current = merged();
    setOptions({
      ...current,
      kanbanFields: {
        ...current.kanbanFields,
        [field]: !current.kanbanFields[field],
      },
    });
  };

  return { options: merged, toggleListColumn, toggleKanbanField };
}

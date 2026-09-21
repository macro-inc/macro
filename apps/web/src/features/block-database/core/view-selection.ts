import { deepEqual } from '@core/util/compareUtils';
import { type DatabaseViewConfig, isDatabaseViewConfig } from './database-view';

export type TableViewState = {
  view: DatabaseViewConfig;
  selectedViewId?: string;
};
export type DatabaseViewSelection = {
  tableId?: string;
  views: Record<string, string>;
  drafts: Record<string, TableViewState>;
};

/** Acknowledging an earlier save must not discard a newer edit or selection. */
export function clearSavedViewDraft(
  selection: DatabaseViewSelection,
  tableId: string,
  viewId: string,
  saved: DatabaseViewConfig
): DatabaseViewSelection {
  const draft = selection.drafts[tableId];
  if (draft?.selectedViewId !== viewId || !deepEqual(draft.view, saved))
    return selection;
  const drafts = { ...selection.drafts };
  delete drafts[tableId];
  return { ...selection, drafts };
}

/** Old selections remain readable; malformed browser state never prevents opening a database. */
export function readViewSelection(
  raw: string | null | undefined
): DatabaseViewSelection | undefined {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const stored = value as Record<string, unknown>;
    const views =
      stored.views &&
      typeof stored.views === 'object' &&
      !Array.isArray(stored.views)
        ? Object.fromEntries(
            Object.entries(stored.views).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string'
            )
          )
        : {};
    const drafts: Record<string, TableViewState> = {};
    if (
      stored.drafts &&
      typeof stored.drafts === 'object' &&
      !Array.isArray(stored.drafts)
    ) {
      for (const [id, draft] of Object.entries(stored.drafts)) {
        if (
          !draft ||
          typeof draft !== 'object' ||
          !isDatabaseViewConfig(draft.view)
        )
          continue;
        if (
          draft.selectedViewId !== undefined &&
          typeof draft.selectedViewId !== 'string'
        )
          continue;
        drafts[id] = { view: draft.view, selectedViewId: draft.selectedViewId };
      }
    }
    return {
      tableId: typeof stored.tableId === 'string' ? stored.tableId : undefined,
      views,
      drafts,
    };
  } catch {
    return;
  }
}

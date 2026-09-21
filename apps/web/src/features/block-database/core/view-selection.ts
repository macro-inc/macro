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

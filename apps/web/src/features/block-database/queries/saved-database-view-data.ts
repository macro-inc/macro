import {
  isSavedDatabaseViewConfig,
  type SavedDatabaseView,
} from '../core/database-view';

/** Saved-view storage is shared by several features; every dimension is scoped. */
export function selectSavedDatabaseViews(
  entries: readonly { id: string; name: string; config: unknown }[],
  databaseId: string,
  tableId: string | undefined
): SavedDatabaseView[] {
  return entries.flatMap((entry) => {
    const config = entry.config;
    return isSavedDatabaseViewConfig(config) &&
      config.databaseId === databaseId &&
      config.tableId === tableId
      ? [{ id: entry.id, name: entry.name, view: config.view }]
      : [];
  });
}

/** A row of the touch title menu that the database page adds or orders itself. */
export type DatabaseTitleMenuRow =
  | 'rename'
  | 'duplicate'
  | 'move-to-folder'
  | 'import-csv'
  | 'webhooks'
  | 'download-csv'
  | 'delete';

/**
 * The database's own title menu rows, in order: every Database actions item
 * of the desktop header that this viewer can use. Move to folder and Delete
 * are listed for everyone; the menu itself offers them to the owner only.
 */
export function databaseTitleMenuRows(viewer: {
  canEdit: boolean;
  /** Whether a table is open: webhooks and the download are per table. */
  hasTable: boolean;
}): DatabaseTitleMenuRow[] {
  const rows: DatabaseTitleMenuRow[] = [];

  if (viewer.canEdit) rows.push('rename');
  rows.push('duplicate', 'move-to-folder');
  if (viewer.canEdit) rows.push('import-csv');
  if (viewer.canEdit && viewer.hasTable) rows.push('webhooks');
  if (viewer.hasTable) rows.push('download-csv');
  rows.push('delete');

  return rows;
}

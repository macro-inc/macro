export default {
  // The database "…" menu item and the dialog it opens.
  syncFrom: 'Sync from…',
  dialogTitle: 'Synced tables',
  dialogDescription:
    'A synced table mirrors its source. Edits made in Macro are overwritten on the next sync, and a row deleted in Macro comes back.',
  loadFailed: "Could not load this database's synced tables.",
  empty: 'No tables here are synced yet.',
  addTable: 'Add a synced table',
  done: 'Done',
  // A sync's row.
  granolaMeetings: 'Granola meetings',
  notionDatabase: 'Notion database',
  syncsInto: 'Syncs into “{{table}}”',
  tableRemoved: 'Its table was deleted',
  statusPending: 'Waiting for the first sync',
  statusSynced: 'Up to date',
  statusFailed: 'Last sync failed',
  lastSynced: 'Last synced {{time}}',
  neverSynced: 'Not synced yet',
  failureSourceDisconnected:
    'The source is disconnected. Reconnect it in Settings to resume syncing.',
  failureSourceNotFound:
    'The source no longer exists, or your connection can no longer read it.',
  failureSourceUnavailable:
    'The source could not be reached. It will try again on its schedule.',
  failureCreatorLostAccess:
    'Whoever set up this sync can no longer edit this database.',
  failureDatabaseUnavailable:
    'This table could not be written. It will try again on its schedule.',
  failureInternal: 'Something went wrong. It will try again on its schedule.',
  detachedColumns: {
    one: '{{count}} column stopped syncing because it was deleted or its type changed: {{columns}}.',
    other:
      '{{count}} columns stopped syncing because they were deleted or their type changed: {{columns}}.',
  },
  syncNow: 'Sync now',
  syncRequested: 'Sync started',
  syncNowFailed: 'Could not start a sync.',
  stopSyncing: 'Stop syncing',
  stopSyncingHint: 'The table and its rows stay',
  stopSyncingFailed: 'Could not stop this sync.',
  openIntegrations: 'Connect it in Settings → Integrations',
  // Choosing a source.
  sourceGranolaDescription: 'Your meetings imported from Granola',
  sourceNotionDescription: 'A database in your Notion workspace',
  granolaNotConnected: 'Granola is not connected.',
  notionNotConnected: 'Notion is not connected.',
  notionNoDatabases: 'Your Notion connection cannot read any databases.',
  sourcesFailed: 'Could not load what you can sync from.',
  alreadySynced: 'Already synced',
  sync: 'Sync',
  creating: 'Creating…',
  createFailed: 'Could not create the synced table.',
  // The launcher's picker.
  pickerTitle: 'New synced database',
  pickerDescription:
    'Creates a database whose table mirrors the source. Edits made in Macro are overwritten on the next sync.',
  createDatabaseFailed: 'Could not create the synced database.',
  cancel: 'Cancel',
};

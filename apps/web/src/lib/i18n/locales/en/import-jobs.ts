/** The desktop tray listing background imports (Notion, Linear, Jira, Slack). */
export default {
  trayLabel: 'Imports',
  summary: { one: '{{count}} import', other: '{{count}} imports' },
  showImports: 'Show imports',
  hideImports: 'Hide imports',
  openImport: 'Open the {{source}} import',
  dismissImport: 'Dismiss the {{source}} import',
  scanningPages: {
    one: 'Scanning {{count}} page',
    other: 'Scanning {{count}} pages',
  },
  scanningIssues: {
    one: 'Reading {{count}} issue',
    other: 'Reading {{count}} issues',
  },
  findingChannels: 'Finding channels',
  deciding: {
    one: 'Deciding on {{count}} item',
    other: 'Deciding on {{count}} items',
  },
  awaitingApproval: 'Waiting for your approval',
  choosingChannels: 'Choose channels in Settings',
  importing: {
    one: 'Importing {{done}} of {{count}}',
    other: 'Importing {{done}} of {{count}}',
  },
  importingChannels: {
    one: 'Importing {{count}} channel',
    other: 'Importing {{count}} channels',
  },
  completed: 'Imported',
  failed: 'Import failed',
  failedAccessLost:
    'Import failed: {{source}} no longer accepts Macro’s connection',
  failedConnectionUnavailable:
    'Import failed: Macro couldn’t use your {{source}} connection',
  failedNotConnected: 'Import failed: {{source}} isn’t connected',
  failedNotFound: 'Import failed: something isn’t shared with Macro',
  failedForbidden: 'Import failed: Macro can’t read part of {{source}}',
  failedRateLimited: 'Import failed: {{source}} is limiting requests',
  failedUnreachable: 'Import failed: {{source}} couldn’t be reached',
  failedUsageRefused: 'Import failed: AI usage was refused',
  cancelled: 'Import cancelled',
};

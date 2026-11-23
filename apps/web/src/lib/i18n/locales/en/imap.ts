export default {
  providerPausedUntil: 'Paused by your provider until {{time}}',
  useAppPassword: 'Use an app password instead',
  googlePermissions: 'Keep email access enabled on Google’s permission screen.',
  addressUnverified:
    'Connect a verified address associated with your Macro account.',
  providerConflict: 'This address already has an inbox connection.',
  connectionChanged:
    'This inbox changed while you were connecting. Close this window and open it again.',
  disabled: 'New IMAP connections are temporarily unavailable.',
  credentialsRejected:
    'Sign-in was rejected. Check your username and app password.',
  dnsUnavailable:
    'Could not find the mail server. Check the server name and try again.',
  tcpUnavailable:
    'Could not reach the mail server. Check its port and try again.',
  tlsUnavailable:
    'Could not establish a secure connection. Check the server name and TLS settings.',
  timedOut:
    'The mail server took too long to respond. Try again in a few minutes.',
  invalidSettings:
    'Check the server names, ports and usernames, then confirm the servers.',
  throttled: 'Too many attempts. Wait a few minutes before trying again.',
  connectionUnavailable:
    'Could not verify the connection. Check the server settings and try again.',
  incoming: 'Incoming mail (IMAP)',
  outgoing: 'Outgoing mail (SMTP)',
  reconnect: 'Reconnect inbox',
  reconnectAction: 'Reconnect',
  connectEmail: 'Connect email',
  findSettings: 'Find settings',
  connectInbox: 'Connect inbox',
  serverName: 'Server name',
  connection: 'Connection',
  username: 'Username',
  emailAddress: 'Email address',
  changeAddress: 'Change address',
  serverSettings: 'Server settings',
  appPasswordHelp: 'Create an app password',
  password: 'Password or app password',
  separatePassword: 'Use a separate outgoing password',
  outgoingPassword: 'Outgoing password',
  cancel: 'Cancel',
  tlsPort: '{{port}} (SSL/TLS)',
  startTlsPort: '{{port}} (STARTTLS)',
  continueWith: 'Continue with {{provider}}',
  noMailbox:
    '{{provider}} does not provide a mailbox Macro can connect to directly.',
  trustServer: 'I trust {{server}} with my mail credentials.',
  trustServers:
    'I trust {{incoming}} and {{outgoing}} with my mail credentials.',
  incomingServer: 'the incoming server',
  outgoingServer: 'the outgoing server',
  roleInbox: 'Inbox',
  roleSent: 'Sent',
  roleDrafts: 'Drafts',
  roleArchive: 'Archive',
  roleTrash: 'Trash',
  roleJunk: 'Junk',
  roleOther: 'Other',
  automaticRole: 'Automatic ({{role}})',
  readFailed:
    'Mail settings could not be loaded. Close this window and try again.',
  settingsChanged:
    'This inbox changed. Review the current settings and save again.',
  invalidFolders:
    'Choose one folder for each role. The inbox must stay included.',
  saveFailed: 'Could not save mail settings. Try again.',
  features: 'Server features',
  messageLimit: 'Outgoing message limit',
  lastVerified: 'Connection last verified',
  mailServerSettings: 'Mail server settings',
  loadingSettings: 'Loading settings…',
  changeLogin: 'Change login details',
  folders: 'Folders',
  foldersPending: 'Folders will appear after the first sync.',
  outsideSync: 'Outside the latest sync',
  serverDraftsNotSynced: 'Server drafts are not synced to Macro.',
  credentialsUnreadableTitle: 'Reconnect your inbox',
  credentialsUnreadableDetails:
    "Macro can't read this mailbox's saved password. Reconnect to continue.",
  mailboxTooLargeTitle: 'Mailbox too large to sync yet',
  mailboxSizeRetry:
    'Unselect large folders in Mail settings, or Macro will retry at {{time}}. Previously synced messages remain available.',
  mailboxSizePaused:
    'Unselect large folders in Mail settings to try syncing again. Previously synced messages remain available.',
  mailboxIssueDetails: 'Open mailbox settings for details before trying again.',
  mailboxIssue:
    'Mailbox sync needs attention. Open server settings for details.',
  inboxAlwaysSynced: 'Inbox · Always synced',
  role: 'Role',
  syncFolder: 'Sync folder',
  watchFolder: 'Watch for new mail alongside Inbox',
  inboxOnly: 'Inbox only',
  close: 'Close',
  saveSettings: 'Save settings',
  gmailExtensions: 'Gmail extensions',
  bytes: {
    one: '{{count}} byte',
    other: '{{count}} bytes',
  },
  setupInstructions: '{{provider}} setup instructions',
  mailProvider: 'Mail provider',
  unsyncedFolders: {
    one: '{{count}} included folder was outside the last sync. Macro syncs up to 200 physical folders and prioritizes the inbox, assigned roles, and watched folders.',
    other:
      '{{count}} included folders were outside the last sync. Macro syncs up to 200 physical folders and prioritizes the inbox, assigned roles, and watched folders.',
  },
  roleFor: 'Role for {{folder}}',
  syncNamedFolder: 'Sync {{folder}}',
};

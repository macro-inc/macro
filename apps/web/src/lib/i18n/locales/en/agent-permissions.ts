/** Agent permissions in Settings → Agents, and the controls chat cards share. */
export default {
  title: 'Permissions',
  permissionsButton: 'Permissions',
  agentPermissions: "{{agent}}'s permissions",
  sectionDescription:
    'What this agent may do in its programs. Changes save right away.',
  toolPermissionsTitle: 'Tool permissions',
  toolPermissionsDescription:
    'Choose a default for each action. Add exceptions by entity.',
  settingsChanged: {
    one: '{{count}} setting changed',
    other: '{{count}} settings changed',
  },
  setByAgentCount: { other: '{{count}} set by {{agent}} itself' },
  reset: 'Reset permissions',
  scopeLead:
    'Applies to every program {{agent}} runs in sessions where agent permissions are on.',
  scopeBody:
    'A program reaches Macro only through steps these settings check; the code it runs on the side can’t reach Macro at all. {{agent}}’s other tools and your connected apps aren’t covered: they work as before, even where a setting says Never.',
  readOnly: 'Only people who can edit {{agent}} can change these.',
  loading: 'Loading permissions',

  allow: 'Allow',
  ask: 'Ask',
  never: 'Never',
  alwaysAllow: 'Always allow',
  askPermission: 'Ask permission',
  neverAllow: 'Never allow',
  allowHint: 'Always allow: runs without asking',
  askHint: 'Ask permission: waits for your approval each time',
  neverHint: 'Never allow: refused before anything runs',
  controlLabel: '{{group}}: {{action}}',
  defaultLabel: '{{action}} default',

  actionRead: 'Read',
  actionCreate: 'Create',
  actionEdit: 'Edit',
  actionSend: 'Send',
  actionDelete: 'Delete',
  actionHeader: 'Action',
  defaultHeader: 'Default permission',
  defaultMenu: '{{action}} default permission',
  exceptionCount: { one: '{{count}} exception', other: '{{count}} exceptions' },
  toolSettingCount: {
    one: '{{count}} tool setting',
    other: '{{count}} tool settings',
  },
  exceptionsTitle: '{{action}} exceptions',
  addException: 'Add exception',
  addExceptionFor: 'Add a {{action}} exception',
  searchEntities: 'Search entities',
  noEntityMatch: 'No entity matches',
  choosePermission: 'Choose permission',
  useDefault: 'Use default ({{state}})',
  clearException: '{{entity}}: use default ({{state}})',
  othersFollow: {
    one: 'The other entity follows the {{action}} default.',
    other: 'The other {{count}} entities follow the {{action}} default.',
  },
  allFollow: {
    one: 'The one entity with {{action}} tools follows the default.',
    other: 'All {{count}} entities follow the {{action}} default.',
  },
  individualTools: 'Individual tools',
  removeToolSetting: 'Remove the setting for {{tool}}',

  toolCount: { one: '{{count}} tool', other: '{{count}} tools' },
  differCount: { one: '{{count}} differs', other: '{{count}} differ' },
  noTools: 'No tools yet',
  setByAgent: 'Set by agent',
  thisSession: 'This session',
  toolDiffers: 'Differs · {{action}} is {{state}}',
  ownSetting: 'Own setting',
  follows: 'follows {{action}}',
  useActionSetting: 'Use the {{action}} setting',

  saveFailed: "Couldn't save {{target}}",
  saveFailedBody: "It's back to {{state}}. Try again.",
  resetDone: 'Permissions reset',
  resetFailed: "Couldn't reset permissions",

  loadFailed: "Couldn't load permissions",
  loadFailedBody: 'Check your connection and try again.',
  tryAgain: 'Try again',
  unavailable: "Permissions aren't available for this agent.",

  resetTitle: "Reset {{agent}}'s permissions?",
  resetBody: 'Every setting goes back to Allow.',
  resetBodyAgent: {
    one: 'That includes one that {{agent}} set for itself.',
    other: 'That includes {{count}} that {{agent}} set for itself.',
  },
  resetBodyEnd:
    "Limits {{agent}} set for a single session stay until that session ends. This can't be undone.",
  resetConfirm: 'Reset',
  cancel: 'Cancel',
};

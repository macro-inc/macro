/** Agent permissions in Settings → Agents, and the controls chat cards share. */
export default {
  title: 'Permissions',
  permissionsButton: 'Permissions',
  agentPermissions: "{{agent}}'s permissions",
  newSectionDescription:
    'What this agent may do in its programs. Saved with the agent.',
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
  resetBodyFollowers: 'Agents that follow these permissions change too.',
  removeRestrictions: 'Remove restrictions',
  removeRestrictionsTitle: 'Remove {{agent}}’s own restrictions?',
  removeRestrictionsBody:
    'Removes this agent’s own restrictions. It keeps following {{source}}’s permissions.',
  cancel: 'Cancel',

  restrictedByAgent: 'Restricted by the agent: {{state}}',
  restrictedHere: 'Restricted here: {{state}}',
  removeRestriction: 'Remove the restriction on {{target}}',
  permissionMode: 'Permissions',
  useAnotherAgents: 'Use another agent’s permissions',
  setMyOwn: 'Set my own permissions',
  useMyOwn: 'Use my own permissions',
  useSamePermissionsAs: 'Use same permissions as',
  setAgent: 'Set agent',
  scopePersonal: 'Personal',
  scopeTeam: 'Team · {{team}}',
  scopeTeamOnly: 'Team',
  teamDefault: 'Team default',
  teamDefaultMention: 'the team default',
  sourceDeletedBadge: 'Deleted',
  sourceWouldLoop: 'Would follow itself',
  sourceTooDeep: 'Too many agents in a row',
  followsChanges:
    'This agent automatically follows permission changes made to {{source}}.',
  followsVia: '{{source}} follows {{via}}.',
  followsEditHint:
    'To follow another agent or use its own permissions, edit the agent.',
  sourceLost:
    'The agent this one followed is gone, so it asks before everything. Pick another agent or use its own permissions.',
  sourceDeleted:
    '{{source}} was deleted. Its permissions stay as they were and can’t be changed.',
  sourceOutOfScope:
    '{{source}} is no longer one this agent can follow. Pick another agent or use its own permissions.',
  showSourcePermissions: 'Show {{source}}’s permissions',
  hideSourcePermissions: 'Hide {{source}}’s permissions',
  noSourcePicked:
    'No agent to follow yet. Pick one, or set this agent’s own permissions.',
  pickSource: 'Pick an agent whose permissions this one follows.',
  ownDescription: 'Set defaults for this agent and add exceptions by entity.',
  useOwnExplained:
    'Copies what it follows into its own settings and stops following. Nothing changes until you edit them.',
  setSourceFailed: 'Couldn’t change what this agent follows',
  detachFailed: 'Couldn’t switch to its own permissions',
  followTitle: 'Follow {{source}}?',
  followConfirm: 'Follow',
  followBody:
    '{{agent}}’s own settings will be replaced by what it follows. Restrictions the agent set on itself stay.',
  draftFailed: 'Agent created, but its permissions weren’t saved',
  draftFailedBody: 'It follows its default permissions for now.',
};

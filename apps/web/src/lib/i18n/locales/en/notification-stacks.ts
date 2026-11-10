export default {
  // Settings section
  sectionTitle: 'Stacks',
  sectionDescription:
    'A stack captures the notifications you choose into Noise. They make no sound, show no badge and send no push, and wait in the Noise tab of Notifications.',
  newStack: 'New stack',
  loading: 'Loading stacks…',
  loadFailed: 'Could not load stacks',
  retry: 'Retry',
  empty: 'No stacks yet',

  // Rows
  enabledLabel: 'Capture with {{name}}',
  moreActions: 'More actions for {{name}}',
  edit: 'Edit',
  moveUp: 'Move up',
  moveDown: 'Move down',
  delete: 'Delete',
  deleteTitle: 'Delete “{{name}}”?',
  deleteBody: 'Notifications it already captured stay in Noise.',
  deleteConfirm: 'Delete stack',
  updateFailed: 'Could not update the stack',
  deleteFailed: 'Could not delete the stack',
  reorderFailed: 'Could not reorder your stacks',

  // Row summary
  summaryEverywhere: 'Everywhere',
  summaryChannels: {
    one: '{{count}} channel',
    other: '{{count}} channels',
  },
  summaryNamed: 'Channels named “{{text}}”',
  summaryDocuments: {
    one: '{{count}} document',
    other: '{{count}} documents',
  },
  summaryFolders: {
    one: '{{count}} folder',
    other: '{{count}} folders',
  },
  summaryProjects: {
    one: '{{count}} task project',
    other: '{{count}} task projects',
  },
  summaryPeople: {
    one: 'From {{count}} person',
    other: 'From {{count}} people',
  },
  summaryReleases: 'Lets {{kinds}} through',
  summaryCustomRules: 'Custom rules',

  // Editor
  editStack: 'Edit stack',
  editorDescription:
    'Captured notifications go to Noise: no sound, no badge and no push.',
  name: 'Stack name',
  namePlaceholder: 'Support channels',
  captureFrom: 'Capture notifications from',
  captureEmpty: 'Anywhere, from anyone',
  add: 'Add',
  kindChannel: 'Channels',
  kindDocument: 'Documents and tasks',
  kindFolder: 'Folders',
  kindProject: 'Task projects',
  kindPerson: 'People',
  nameContains: 'Channel name contains',
  nameContainsPlaceholder: 'support',
  nameContainsHint: 'Matches channels, never direct messages.',
  addNameText: 'Add',
  nameContainsChip: 'Channels named “{{text}}”',
  remove: 'Remove {{name}}',
  removeItem: 'Remove',
  pickerDone: 'Done',
  searchChannel: 'Search channels…',
  searchDocument: 'Search documents and tasks…',
  searchFolder: 'Search folders…',
  searchProject: 'Search task projects…',
  searchPerson: 'Search people…',
  pickerLoading: 'Loading…',
  kinds: 'Kinds',
  kindsHint: 'Leave all unchecked to capture every kind.',
  kindNewMessage: 'New messages',
  kindMention: 'Mentions',
  kindReply: 'Replies',
  kindReaction: 'Reactions',
  kindDocumentMention: 'Document mentions',
  kindComment: 'Comments',
  release: 'Still notify me about',
  releaseMentions: 'Mentions',
  releaseReplies: 'Replies in my threads',
  cancel: 'Cancel',
  save: 'Save',
  create: 'Create stack',
  saveFailed: 'Could not save the stack',
  problemName: 'Give the stack a name.',
  problemCapture:
    'Add a place, a person or a kind. A stack with none would capture everything.',
  notEditable:
    'This stack has rules this editor can’t show. You can still turn it off or delete it.',

  // Add a channel to a stack
  addToStackTitle: 'Add to a stack',
  addToStackDescription:
    'Notifications from this channel go to Noise, except what the stack lets through.',
  addToStackEmpty: 'You have no stacks yet.',
  newStackForChannel: 'New stack with this channel',
  done: 'Done',
};

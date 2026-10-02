/** Block types accepted by the application. Keep this module free of BlockLoader imports. */
export const BlockRegistry = [
  'call',
  'calendar',
  'chat',
  'write',
  'pdf',
  'md',
  'code',
  'image',
  'canvas',
  'spreadsheet',
  'channel',
  'project',
  'unknown',
  'video',
  'email',
  'contact',
  'company',
  'automation',
  'pr',
  'agent',
  // A task project (`project` is a folder).
  'initiative',
] as const;

/** Aliases for block types that share a concrete block implementation. */
export const BlockAliasRegistry = ['csv', 'task', 'snippet', 'skill'] as const;

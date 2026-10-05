/** Block types accepted by the application. Keep this module free of BlockLoader imports. */
export const BlockRegistry = [
  'call',
  'calendar',
  'chat',
  'database',
  'write',
  'pdf',
  'md',
  'code',
  'image',
  'canvas',
  'spreadsheet',
  // PowerPoint presentations, edited in the browser.
  'pptx',
  // Photoshop documents, edited in the browser.
  'psd',
  // Figma files, viewed in the browser.
  'fig',
  'channel',
  'project',
  'unknown',
  'video',
  'email',
  'contact',
  'company',
  'routine',
  'pr',
  'agent',
  // A task project (`project` is a folder).
  'initiative',
] as const;

/** Aliases for block types that share a concrete block implementation. */
export const BlockAliasRegistry = ['csv', 'task', 'snippet', 'skill'] as const;

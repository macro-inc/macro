export const VIEWS = [
  'inbox',
  'agents',
  'mail',
  'documents',
  'tasks',
  'channels',
  'files',
] as const;

export type View = (typeof VIEWS)[number];

export const VIEW_PATHS = {
  inbox: '/inbox',
  agents: '/agents',
  mail: '/mail',
  documents: '/documents',
  tasks: '/tasks',
  channels: '/channels',
  files: '/files',
} as const satisfies Record<View, string>;

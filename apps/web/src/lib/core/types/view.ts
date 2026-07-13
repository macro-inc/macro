export const DEFAULT_VIEWS = [
  'signal',
  'noise',
  'people',
  'email',
  'files',
  'tasks',
  'folders',
  'all',
] as const;

export type DefaultView = (typeof DEFAULT_VIEWS)[number];

/** equal to DefaultView type for default view, otherwise a uuid type */
export type ViewId = DefaultView | string;

/** equal to upper case View type for default view, otherwise a custom string label */

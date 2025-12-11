import { ENABLE_TASKS } from '../constant/featureFlags';

export const DEFAULT_VIEWS = [
  'signal',
  'noise',
  'people',
  'files',
  ...(ENABLE_TASKS ? (['tasks'] as const) : []),
  'folders',
  'all',
] as const;

export type DefaultView = (typeof DEFAULT_VIEWS)[number];

/** equal to DefaultView type for default view, otherwise a uuid type */
export type ViewId = DefaultView | string;

/** equal to upper case View type for default view, otherwise a custom string label */
export type ViewLabel = string;

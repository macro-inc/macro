import { ENABLE_EMAIL_VIEW } from 'core/constant/featureFlags';

export const DEFAULT_VIEWS = [
  'inbox',
  'comms',
  'docs',
  'ai',
  'folders',
] as const;

export const CONDITIONAL_VIEWS = ['emails', 'all'] as const;

export type DefaultView = (typeof DEFAULT_VIEWS)[number];
export type ConditionalView = (typeof CONDITIONAL_VIEWS)[number];

export type View = DefaultView | ConditionalView;

const VIEW_DEFINITIONS: Array<{ key: View; disabled?: boolean }> = [
  { key: 'all' },
  { key: 'inbox' },
  { key: 'emails', disabled: !ENABLE_EMAIL_VIEW },
  { key: 'comms' },
  { key: 'docs' },
  { key: 'ai' },
  { key: 'folders' },
];

export const VIEWS = VIEW_DEFINITIONS.filter((v) => !v.disabled).map(
  (v) => v.key
);

/** equal to View type for default view, otherwise a uuid type */
export type ViewId = View | string;

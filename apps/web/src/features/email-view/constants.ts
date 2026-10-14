/**
 * Existing tab ids match the legacy mail view (`important` is Signal).
 * Favorites extends that list; entity action capabilities use `${view}-${tab}`.
 * Focus comes last so the Signal/Noise pair keeps its position and hotkeys;
 * the sidebar draws it above them.
 */
export const EMAIL_TAB_IDS = [
  'important',
  'noise',
  'favorites',
  'sent',
  'scheduled',
  'reminders',
  'calendar',
  'drafts',
  'shared',
  'archived',
  'all',
  'focus',
] as const;

export type EmailTab = (typeof EMAIL_TAB_IDS)[number];

const EMAIL_TAB_LABELS = {
  important: 'Signal',
  noise: 'Noise',
  favorites: 'Favorites',
  sent: 'Sent',
  scheduled: 'Scheduled',
  reminders: 'Reminders',
  calendar: 'Calendar',
  drafts: 'Drafts',
  shared: 'Shared',
  archived: 'Archived',
  all: 'All',
  focus: 'Focus',
} as const satisfies Record<EmailTab, string>;

export type EmailTabItem = {
  id: EmailTab;
  label: string;
  /** A short status beside the label, e.g. for an experimental tab. */
  badge?: string;
};

export const EMAIL_TABS: readonly EmailTabItem[] = EMAIL_TAB_IDS.map((id) => ({
  id,
  label: EMAIL_TAB_LABELS[id],
}));

export const DEFAULT_EMAIL_TAB: EmailTab = 'important';

/** Drawn first in the sidebar, above the Signal/Noise pair. */
export const EMAIL_FOCUS_TAB: EmailTabItem = {
  id: 'focus',
  label: EMAIL_TAB_LABELS.focus,
  badge: 'Experimental',
};

/** How the Focus tab orders its threads. */
export const EMAIL_FOCUS_SORT_IDS = [
  'priority',
  'importance',
  'recent',
] as const;

export type EmailFocusSort = (typeof EMAIL_FOCUS_SORT_IDS)[number];

export const DEFAULT_EMAIL_FOCUS_SORT: EmailFocusSort = 'priority';

export const EMAIL_FOCUS_SORT_OPTIONS: readonly {
  id: EmailFocusSort;
  label: string;
  /** A second line in the sort menu, for orders the label can't explain. */
  description?: string;
}[] = [
  {
    id: 'priority',
    label: 'Priority',
    description: 'Importance, halved every 2 days since mail last came in',
  },
  { id: 'importance', label: 'Importance' },
  { id: 'recent', label: 'Most recent' },
];

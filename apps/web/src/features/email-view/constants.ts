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
} as const satisfies Record<EmailTab, string>;

export type EmailTabItem = {
  id: EmailTab;
  label: string;
};

export const EMAIL_TABS: readonly EmailTabItem[] = EMAIL_TAB_IDS.map((id) => ({
  id,
  label: EMAIL_TAB_LABELS[id],
}));

export const DEFAULT_EMAIL_TAB: EmailTab = 'important';

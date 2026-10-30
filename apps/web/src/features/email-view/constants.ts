import { t } from '@app/lib/i18n';

import { EMAIL_TAB_IDS, type EmailTab } from './tabs';

export { EMAIL_TAB_IDS, type EmailTab } from './tabs';

export const EMAIL_TAB_LABELS = {
  get important() {
    return t('viewMenus.signal');
  },
  get noise() {
    return t('viewMenus.noise');
  },
  get favorites() {
    return t('viewMenus.favorites');
  },
  get sent() {
    return t('viewMenus.sent');
  },
  get scheduled() {
    return t('viewMenus.scheduled');
  },
  get reminders() {
    return t('viewMenus.reminders');
  },
  get calendar() {
    return t('viewMenus.calendar');
  },
  get drafts() {
    return t('viewMenus.drafts');
  },
  get shared() {
    return t('viewMenus.shared');
  },
  get archived() {
    return t('viewMenus.archived');
  },
  get all() {
    return t('viewMenus.all');
  },
  get spam() {
    return t('viewMenus.spam');
  },
  get trash() {
    return t('viewMenus.trash');
  },
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
  get label() {
    return EMAIL_TAB_LABELS[id];
  },
}));

export const DEFAULT_EMAIL_TAB: EmailTab = 'important';

/** The views behind the desktop sidebar's Inbox item, as the header's tabs. */
export const EMAIL_INBOX_TAB_IDS = [
  'focus',
  'important',
  'noise',
] as const satisfies readonly EmailTab[];

export const isEmailInboxTab = (tab: EmailTab) =>
  (EMAIL_INBOX_TAB_IDS as readonly EmailTab[]).includes(tab);

/** Leads the mobile pills and the touch sidebar, above the Signal/Noise pair. */
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

/** Provider folders have separate membership and currently use network pages. */
export const isExcludedEmailFolder = (tab: EmailTab): tab is 'spam' | 'trash' =>
  tab === 'spam' || tab === 'trash';

/** Full-text search does not yet expose provider spam/trash folder scopes. */
export const canSearchEmailTab = (tab: EmailTab): boolean =>
  tab !== 'scheduled' && tab !== 'reminders' && !isExcludedEmailFolder(tab);

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

/**
 * What the navigation and the header show: a tab, the whole Inbox (an
 * `in:inbox` search), or a search of all mail, which is no view.
 */
export type EmailShownView = EmailTab | 'inbox' | 'search';

export const emailShownViewTitle = (view: EmailShownView): string => {
  if (view === 'search') return t('common.search');
  if (view === 'inbox') return t('viewMenus.inbox');
  return EMAIL_TAB_LABELS[view];
};

/** How the Focus tab orders its threads. */
export const EMAIL_FOCUS_SORT_IDS = ['recent', 'importance'] as const;

export type EmailFocusSort = (typeof EMAIL_FOCUS_SORT_IDS)[number];

export const DEFAULT_EMAIL_FOCUS_SORT: EmailFocusSort = 'recent';

export const EMAIL_FOCUS_SORT_OPTIONS: {
  id: EmailFocusSort;
  label: string;
}[] = [
  { id: 'recent', label: 'Most recent' },
  { id: 'importance', label: 'Importance' },
];

/** Provider folders have separate membership and currently use network pages. */
export const isExcludedEmailFolder = (tab: EmailTab): tab is 'spam' | 'trash' =>
  tab === 'spam' || tab === 'trash';

/**
 * Search covers all mail from every tab but Spam and Trash, whose mail the
 * search index leaves out.
 */
export const canSearchEmailTab = (tab: EmailTab): boolean =>
  !isExcludedEmailFolder(tab);

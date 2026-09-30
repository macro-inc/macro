import type { EmailTab } from './types';

export type EmailTabItem = {
  id: EmailTab;
  label: string;
};

export const EMAIL_TABS: EmailTabItem[] = [
  { id: 'important', label: 'Signal' },
  { id: 'noise', label: 'Noise' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'sent', label: 'Sent' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'calendar', label: 'Calendar' },
  // Flag-gated; every tab surface goes through `useVisibleEmailTabs`, so an
  // unflagged user never sees it (or reaches it by hotkey).
  { id: 'reminders', label: 'Reminders' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'shared', label: 'Shared' },
  { id: 'all', label: 'All' },
];

export const EMAIL_TAB_IDS: EmailTab[] = EMAIL_TABS.map((tab) => tab.id);

export const DEFAULT_EMAIL_TAB: EmailTab = 'important';

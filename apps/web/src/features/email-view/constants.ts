import type { EmailTab } from './types';

export type EmailTabItem = {
  id: EmailTab;
  label: string;
};

export const EMAIL_TABS: EmailTabItem[] = [
  { id: 'important', label: 'Signal' },
  { id: 'noise', label: 'Noise' },
  { id: 'sent', label: 'Sent' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'shared', label: 'Shared' },
  { id: 'all', label: 'All' },
];

export const EMAIL_TAB_IDS: EmailTab[] = EMAIL_TABS.map((tab) => tab.id);

export const DEFAULT_EMAIL_TAB: EmailTab = 'important';

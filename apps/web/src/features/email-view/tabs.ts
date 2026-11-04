/**
 * Existing tab ids match the legacy mail view (`important` is Signal).
 * Keep existing IDs ordered to preserve tab hotkeys.
 * Favorites extends that list; entity action capabilities use `${view}-${tab}`.
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
  'spam',
  'trash',
] as const;

export type EmailTab = (typeof EMAIL_TAB_IDS)[number];

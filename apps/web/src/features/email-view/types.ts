import type { FacetSelection } from '@app/features/soup';

/**
 * Existing tab ids match the legacy mail view (`important` is Signal).
 * Favorites extends that list; entity action capabilities use `${view}-${tab}`.
 * Reminders is not a mailbox slice: it lists the user's reminders, which live
 * under Email rather than behind a rail button of their own.
 */
export type EmailTab =
  | 'important'
  | 'noise'
  | 'favorites'
  | 'sent'
  | 'scheduled'
  | 'calendar'
  | 'drafts'
  | 'shared'
  | 'reminders'
  | 'all';

export type EmailFilterGroupId =
  | 'read'
  | 'done'
  | 'attachments'
  | 'calendar'
  | 'tags'
  | 'reminders';

/** The Reminders tab's one axis, mirroring the former standalone view's tabs. */
export type ReminderStatusFilter = 'active' | 'scheduled' | 'done';

export type EmailFilterOptionId =
  | 'all'
  | 'unread'
  | 'read'
  | 'not-done'
  | 'done'
  | 'attachment-pdf'
  | 'attachment-image'
  | 'attachment-document'
  | 'has-calendar-invite'
  | ReminderStatusFilter;

export type EmailViewState = {
  tab: EmailTab;
  search: string;
  /**
   * Linked inboxes the list is scoped to. Tri-state, like the legacy mail
   * view's `inboxFilter`: `undefined` = every inbox (the default), `[]` =
   * explicitly none, otherwise the selected email link ids.
   */
  inboxIds: string[] | undefined;
  facets: FacetSelection;
  /** Sidebar sections the user folded away; kept per user, not per visit. */
  collapsedSidebarSectionIds: string[];
};

export type EmailViewStateOptions = Partial<EmailViewState>;

export type EmailThreadTarget = {
  id: string;
  fallbackName?: string;
};

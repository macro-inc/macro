import type { FacetSelection } from '@app/features/soup';

/**
 * Existing tab ids match the legacy mail view (`important` is Signal).
 * Favorites extends that list; entity action capabilities use `${view}-${tab}`.
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
  | 'all';

export type EmailFilterGroupId =
  | 'read'
  | 'done'
  | 'attachments'
  | 'calendar'
  | 'tags';

export type EmailFilterOptionId =
  | 'all'
  | 'unread'
  | 'read'
  | 'not-done'
  | 'done'
  | 'attachment-pdf'
  | 'attachment-image'
  | 'attachment-document'
  | 'has-calendar-invite';

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

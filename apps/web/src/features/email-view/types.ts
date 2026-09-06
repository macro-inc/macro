import type { FacetSelection } from '@app/features/soup';

/**
 * Tab ids match the legacy mail view's `VIEW_TAB_LISTS.mail` values (`important`
 * is the Signal tab) so entity actions keyed on `${view}-${tab}` — mark done,
 * the sender-policy bucket — keep working unchanged.
 */
export type EmailTab =
  | 'important'
  | 'noise'
  | 'sent'
  | 'calendar'
  | 'drafts'
  | 'shared'
  | 'all';

export type EmailFilterGroupId = 'read' | 'done' | 'attachments' | 'calendar';

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
};

export type EmailViewStateOptions = Partial<EmailViewState>;

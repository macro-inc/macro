import type { FacetSelection } from '@app/features/soup';
import type { EmailFocusSort, EmailTab } from './constants';

export type { EmailFocusSort, EmailTab };

export type EmailFilterGroupId =
  | 'read'
  | 'done'
  | 'attachments'
  | 'calendar'
  | 'focus'
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
  | 'has-calendar-invite'
  | 'focus-reply-needed'
  | 'focus-follow-up';

/** Where a participant condition looks for its people. */
export type EmailParticipantField = 'from' | 'to' | 'cc' | 'bcc';

/** A person a view matches: one address, or a whole domain. */
export type EmailParticipant =
  | { type: 'address'; email: string }
  | { type: 'domain'; domain: string };

/** How many days back a view looks, by latest activity. */
export const EMAIL_RECEIVED_WITHIN_DAYS = [1, 7, 30, 90] as const;
export type EmailReceivedWithinDays =
  (typeof EMAIL_RECEIVED_WITHIN_DAYS)[number];

/**
 * A saved view's restrictions that have no Filters menu control. Values within
 * one condition are alternatives; separate conditions all apply.
 */
export type EmailViewConditions = {
  importance?: 'signal' | 'noise';
  participants: EmailParticipant[];
  participantFields: EmailParticipantField[];
  subject: string[];
  receivedWithinDays?: EmailReceivedWithinDays;
  starred: boolean;
};

export type EmailViewState = {
  tab: EmailTab;
  search: string;
  /**
   * Linked inboxes the list is scoped to. Tri-state, like the legacy mail
   * view's `inboxFilter`: `undefined` = every inbox (the default), `[]` =
   * explicitly none, otherwise the selected email link ids.
   */
  inboxIds: string[] | undefined;
  /** An alias is always scoped to the inbox that owns its provider grant. */
  aliasFilter?: { inboxId: string; emailAddress: string };
  facets: FacetSelection;
  /** The Focus tab's order; kept per user. */
  focusSort: EmailFocusSort;
  /** Sidebar sections the user folded away; kept per user, not per visit. */
  collapsedSidebarSectionIds: string[];
  /**
   * The open saved view's conditions, on the All tab. Undefined on built-in
   * tabs; never persisted, since the view's definition restores them.
   */
  conditions?: EmailViewConditions;
  /** Where leaving the open saved view returns, and what persists meanwhile. */
  beforeSavedView?: Pick<EmailViewState, 'tab' | 'inboxIds' | 'aliasFilter'>;
};

export type EmailViewStateOptions = Partial<EmailViewState>;

export type EmailThreadTarget = {
  id: string;
  fallbackName?: string;
};

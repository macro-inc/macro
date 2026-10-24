import type { EntityWithRawNotifications } from '@app/features/soup/entity-notifications';
import type { EntityData } from '@entity';
import type { UnifiedNotification } from '@notifications/types';
import { type Accessor, createContext, useContext } from 'solid-js';
import type { InboxRow, InboxRowType } from '../core/inbox-row';

/** What one inbox row presents. */
export type InboxRowContent = {
  /** The row's entity, carrying only the row's notifications. */
  entity: EntityWithRawNotifications<EntityData>;
  /** The row's notifications, newest first; the first names the row. */
  notifications: UnifiedNotification[];
};

export type NotificationInboxRow = InboxRow<InboxRowContent>;

/** Which rows a feed shows; with no row types it shows and reads nothing. */
export type InboxScope = {
  rowTypes: readonly InboxRowType[];
};

/** A completed done, which the caller can reverse once. */
export type InboxDoneResult = { undo: () => Promise<void> };

/** One live inbox feed for a scope. */
export type InboxFeedSource = {
  /**
   * The loaded rows, newest first, without rows hidden as done. Undefined
   * until the first page is available; [] is a loaded empty inbox.
   */
  rows: Accessor<readonly NotificationInboxRow[] | undefined>;
  /** The first page is loading. */
  isLoading: Accessor<boolean>;
  /** The last read failed; may coexist with rows already loaded. */
  error: Accessor<Error | undefined>;
  hasMore: Accessor<boolean>;
  isLoadingMore: Accessor<boolean>;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  /**
   * Hide rows now and complete them. Rejects, showing the rows again, when
   * the done fails; resolves to the undo otherwise.
   */
  markDone: (rows: readonly NotificationInboxRow[]) => Promise<InboxDoneResult>;
  /**
   * Read rows as seen now and mark them seen, hidden notifications included;
   * they read as unseen again when that fails.
   */
  markSeen: (rows: readonly NotificationInboxRow[]) => Promise<void>;
};

/** A pending request to access an entity the viewer can share. */
export type AccessRequest = {
  kind: 'access_request';
  entityType: string;
  entityId: string;
  requestId: string;
  revision: number;
  /** What approving grants: the level asked for. */
  level: 'view' | 'comment' | 'edit';
};

/** A request to join a calendar event the viewer shared. */
export type JoinRequest = {
  kind: 'join_request';
  requestId: string;
  eventId: string;
};

/** A request a row's answers resolve. */
export type InboxRequest = AccessRequest | JoinRequest;

/** How row answers reach the server; each rejects when it fails. */
export type InboxRequests = {
  resolveAccessRequest: (
    request: AccessRequest,
    approve: boolean
  ) => Promise<void>;
  answerJoinRequest: (request: JoinRequest, accept: boolean) => Promise<void>;
};

export type NotificationsInboxContext = {
  /** Answer what a row asks for: approve access, answer a join request. */
  requests: InboxRequests;
  /** Create a feed for `scope` under the caller's owner. */
  createFeed: (scope: Accessor<InboxScope>) => InboxFeedSource;
  /**
   * A Macro user's short name: their first name. Read reactively; it
   * resolves after it loads.
   */
  userName: (userId: string) => string | undefined;
  /**
   * The sender a notification names itself, which outranks a Macro user's
   * name: a GitHub login, or a discussion's sender display name.
   */
  senderName: (notification: UnifiedNotification) => string | undefined;
  /** Open a page outside Macro, such as a pull request. */
  openUrl: (url: string) => void;
  /** Where the reader's filters are kept between visits. */
  filterStorage: {
    read: () => string | null;
    write: (value: string) => void;
  };
};

const Context = createContext<NotificationsInboxContext>();

export const NotificationsInboxProvider = Context.Provider;

export function useNotificationsInboxContext(): NotificationsInboxContext {
  const context = useContext(Context);
  if (!context) throw new Error('NotificationsInboxProvider is required');
  return context;
}

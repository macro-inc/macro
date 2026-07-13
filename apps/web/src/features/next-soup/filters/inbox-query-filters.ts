import type { SoupItemsQueryFilters } from '@queries/soup/items';
import type { NotificationFilters } from '@service-storage/generated/schemas';

const INBOX_DONE = false;
const INBOX_IMPORTANCE = true;
const OTHER_IMPORTANCE = false;

const isNonEmptyObject = (obj: Record<string, unknown>) =>
  Object.keys(obj).length > 0;

type FilterWithNotification = {
  notification_filters?: NotificationFilters;
};

function withInboxNotification<T extends FilterWithNotification>(
  filters: T | undefined
): T | undefined {
  if (!filters) {
    return {
      notification_filters: {
        done: INBOX_DONE,
      },
    } as T;
  }
  return {
    ...filters,
    notification_filters: {
      ...filters?.notification_filters,
      done: INBOX_DONE,
    },
  };
}

function withoutInboxNotification<T extends FilterWithNotification>(
  filters: T | undefined
): T | undefined {
  if (!filters) return undefined;
  const { notification_filters, ...rest } = filters;
  if (!notification_filters || notification_filters.done !== INBOX_DONE) {
    return filters;
  }
  const { done: _, ...notifRest } = notification_filters;
  const result = {
    ...rest,
    ...(isNonEmptyObject(notifRest) ? { notification_filters: notifRest } : {}),
  };
  return isNonEmptyObject(result as Record<string, unknown>)
    ? (result as T)
    : undefined;
}

/** Apply inbox query filters to any existing query filter set. */
export function applyInboxQueryFilters(
  filters: SoupItemsQueryFilters
): SoupItemsQueryFilters {
  return {
    ...filters,
    channel_filters: withInboxNotification(filters.channel_filters),
    chat_filters: withInboxNotification(filters.chat_filters),
    project_filters: withInboxNotification(filters.project_filters),
    document_filters: withInboxNotification(filters.document_filters),
    email_filters: { ...filters.email_filters, importance: INBOX_IMPORTANCE },
  };
}

/** Removes inbox specific query filters keeping the rest in place */
export function removeInboxQueryFilters(
  filters: SoupItemsQueryFilters
): SoupItemsQueryFilters {
  const channel_filters = withoutInboxNotification(filters.channel_filters);
  const chat_filters = withoutInboxNotification(filters.chat_filters);
  const project_filters = withoutInboxNotification(filters.project_filters);
  const document_filters = withoutInboxNotification(filters.document_filters);

  // Strip `importance` if it was set by Inbox (true) or Other (false).
  // If importance was set externally, leave email_filters untouched.
  const { importance, ...emailRest } = filters.email_filters ?? {};
  const email_filters =
    importance === INBOX_IMPORTANCE || importance === OTHER_IMPORTANCE
      ? isNonEmptyObject(emailRest)
        ? emailRest
        : undefined
      : filters.email_filters;

  return {
    ...filters,
    channel_filters,
    chat_filters,
    project_filters,
    document_filters,
    email_filters,
  };
}

function withOtherImportance<T>(filters: T | undefined): T | undefined {
  if (!filters) {
    return {
      importance: OTHER_IMPORTANCE,
    } as T;
  }
  return {
    ...filters,
    importance: OTHER_IMPORTANCE,
  };
}
export function applyOtherQueryFilters(
  filters: SoupItemsQueryFilters
): SoupItemsQueryFilters {
  return {
    ...filters,
    channel_filters: withOtherImportance(filters.channel_filters),
    chat_filters: withOtherImportance(filters.chat_filters),
    project_filters: withOtherImportance(filters.project_filters),
    document_filters: withOtherImportance(filters.document_filters),
    email_filters: withOtherImportance(filters.email_filters),
  };
}

function stripOtherImportance<T extends { importance?: unknown }>(
  f: T | undefined
): T | undefined {
  if (!f || f.importance !== OTHER_IMPORTANCE) return f;
  const { importance: _, ...rest } = f;
  return isNonEmptyObject(rest as Record<string, unknown>)
    ? (rest as unknown as T)
    : undefined;
}

export function removeOtherQueryFilters(
  filters: SoupItemsQueryFilters
): SoupItemsQueryFilters {
  return {
    ...filters,
    channel_filters: stripOtherImportance(filters.channel_filters),
    chat_filters: stripOtherImportance(filters.chat_filters),
    project_filters: stripOtherImportance(filters.project_filters),
    document_filters: stripOtherImportance(filters.document_filters),
    email_filters: stripOtherImportance(filters.email_filters),
  };
}

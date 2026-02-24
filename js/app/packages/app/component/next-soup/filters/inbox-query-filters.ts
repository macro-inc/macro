import type { SoupItemsQueryFilters } from '@queries/soup/items';
import type { NotificationFilters } from '@service-storage/generated/schemas';
import { EXCLUDE } from './filters';

const INBOX_DONE = false;
const INBOX_IMPORTANCE = true;
const INBOX_TASK_BYPASS = true;

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
    document_filters: {
      ...withInboxNotification(filters.document_filters),
      task_filters: {
        ...filters.document_filters?.task_filters,
        include_cbm_atm_nc: INBOX_TASK_BYPASS,
      },
    },
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

  const docWithoutNotif = withoutInboxNotification(filters.document_filters);
  const { task_filters: taskFiltersAfterNotif, ...docWithoutTaskFilters } =
    docWithoutNotif ?? {};
  const task_filters =
    taskFiltersAfterNotif ?? filters.document_filters?.task_filters;
  const taskFiltersClean =
    task_filters?.include_cbm_atm_nc === INBOX_TASK_BYPASS
      ? (() => {
          const { include_cbm_atm_nc: _, ...rest } = task_filters;
          return isNonEmptyObject(rest) ? rest : undefined;
        })()
      : task_filters;
  const document_filters =
    isNonEmptyObject(docWithoutTaskFilters) || taskFiltersClean
      ? {
          ...docWithoutTaskFilters,
          ...(taskFiltersClean ? { task_filters: taskFiltersClean } : {}),
        }
      : undefined;

  const { importance, ...emailRest } = filters.email_filters ?? {};
  const email_filters =
    importance === INBOX_IMPORTANCE
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

export function applyOtherQueryFilters(
  filters: SoupItemsQueryFilters
): SoupItemsQueryFilters {
  return {
    ...filters,
    channel_filters: {
      ...filters.channel_filters,
      channel_ids: EXCLUDE,
    },
    chat_filters: {
      ...filters.chat_filters,
      chat_ids: EXCLUDE,
    },
    project_filters: {
      ...filters.project_filters,
      project_ids: EXCLUDE,
    },
    document_filters: {
      ...filters.document_filters,
      document_ids: EXCLUDE,
    },
    email_filters: {
      ...filters.email_filters,
      importance: false,
    },
  };
}

function stripExcludeId<
  T extends Partial<Record<K, unknown>>,
  K extends string,
>(f: T | undefined, key: K): T | undefined {
  if (!f || f[key] !== EXCLUDE) return f;
  const { [key]: _, ...rest } = f;
  return isNonEmptyObject(rest as Record<string, unknown>)
    ? (rest as unknown as T)
    : undefined;
}

export function removeOtherQueryFilters(
  filters: SoupItemsQueryFilters
): SoupItemsQueryFilters {
  const channel_filters = stripExcludeId(
    filters.channel_filters,
    'channel_ids'
  );
  const chat_filters = stripExcludeId(filters.chat_filters, 'chat_ids');
  const project_filters = stripExcludeId(
    filters.project_filters,
    'project_ids'
  );
  const document_filters = stripExcludeId(
    filters.document_filters,
    'document_ids'
  );

  const { importance, ...emailRest } = filters.email_filters ?? {};
  const email_filters =
    importance === false
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

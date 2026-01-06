import { isErr } from '@core/util/maybeResult';
import { emailClient } from '@service-email/client';
import { trackStore } from '@solid-primitives/deep';
import type { UseInfiniteQueryResult } from '@tanstack/solid-query';
import {
  type Accessor,
  batch,
  createDeferred,
  createEffect,
  createMemo,
} from 'solid-js';
import { createStore, reconcile, type Store } from 'solid-js/store';
import type { FetchPaginatedEmailsParams } from '../queries/email';
import { createEmailsInfiniteQuery } from '../queries/email';
import type { EmailEntity } from '../types/entity';

type EmailStore = Record<string, EmailEntity>;
type EmailBySortedView = Record<string, string[]>; // viewKey -> array of email IDs
type EmailQueryParams = Partial<FetchPaginatedEmailsParams>;

export type EmailSource = {
  readonly _store: Store<EmailStore>;
  readonly _query: UseInfiniteQueryResult<EmailEntity[], Error>;
  readonly emails: Accessor<EmailEntity[]>;
  readonly isLoading: Accessor<boolean>;

  setQueryParams: (params: EmailQueryParams) => void;
  getByParams: (params: EmailQueryParams) => EmailEntity[];

  /** Archive or unarchive an email */
  archiveEmail: (id: string, archive: boolean) => Promise<void>;

  /** Mark an email as read */
  markAsRead: (id: string) => Promise<void>;

  /** Refetch emails */
  refetch: () => Promise<void>;
};

const singletonEmailStore = createStore<EmailStore>({});

export function useEmails() {
  const [store] = singletonEmailStore;
  return createMemo(() => Object.values(store));
}

function getViewKey(params?: EmailQueryParams): string {
  const view = params?.view ?? 'inbox';
  const sort = params?.sort_method ?? 'viewed_updated';
  return `${view}-${sort}`;
}

export function createEmailSource(
  maybeQuery?: UseInfiniteQueryResult<EmailEntity[], Error>,
  initialQueryParams: FetchPaginatedEmailsParams = { view: 'inbox' },
  options?: {
    disabled?: Accessor<boolean>;
  }
): EmailSource {
  const [store, setStore] = singletonEmailStore;
  const [sortedView, setSortedView] = createStore<EmailBySortedView>({});
  const [queryParams, setQueryParams] =
    createStore<FetchPaginatedEmailsParams>(initialQueryParams);

  const query =
    maybeQuery ??
    createEmailsInfiniteQuery(() => ({ ...queryParams }), {
      disabled: options?.disabled,
    });

  const emails = createMemo(() => Object.values(store));

  const getByParams = (params: EmailQueryParams) => {
    const viewKey = getViewKey(params);
    const emailIds = trackStore(sortedView[viewKey]) ?? [];

    // Map IDs to actual email entities from the store
    return emailIds.map((id) => store[id]).filter((email) => !!email);
  };

  const isLoading = () => query.isLoading;

  /** Reconcile new emails into the store and update view */
  const reconcileEmails = (emails: EmailEntity[], viewKey: string) =>
    batch(() => {
      const emailsById: EmailStore = {};
      const emailIds: string[] = [];

      for (const email of emails) {
        emailsById[email.id] = email;
        emailIds.push(email.id);
      }

      setStore(emailsById);
      setSortedView(viewKey, reconcile(emailIds, { key: 'id' }));
    });

  // TODO: if something needs emails it needs to be using search query
  const canBackgroundFetch = createDeferred(
    () => false && query.isSuccess && query.hasNextPage && !query.isFetching
  );
  createEffect(() => {
    // don't background fetch for all view, there are too many emails to fetch
    if (queryParams.view === 'all') return;

    if (canBackgroundFetch()) query.fetchNextPage();
  });

  createEffect(() => {
    if (query.isSuccess) reconcileEmails(query.data, getViewKey(queryParams));
  });

  const archiveEmail = async (id: string, value: boolean) => {
    // Optimistically update
    const previousValue = store[id]?.done;
    setStore(id, 'done', value);

    try {
      // Server mutation
      const maybeResult = await emailClient.flagArchived({ id, value });
      if (isErr(maybeResult)) throw maybeResult[0];
    } catch (_) {
      // Rollback on error
      setStore(id, 'done', previousValue);
    } finally {
      // Revalidate
      refetch();
    }
  };

  const markAsRead = async (id: string) => {
    // Optimistically update
    const previousValue = store[id]?.isRead;
    setStore(id, 'isRead', true);

    try {
      // Server mutation
      const maybeResult = await emailClient.markThreadAsSeen({ thread_id: id });
      if (isErr(maybeResult)) throw maybeResult[0];
    } catch (_) {
      // Rollback on error
      setStore(id, 'isRead', previousValue);
    } finally {
      // Revalidate
      refetch();
    }
  };

  const refetch = async () => {
    await query.refetch();
  };

  return {
    _store: store,
    _query: query,
    emails,
    isLoading,
    setQueryParams,
    getByParams,
    archiveEmail,
    markAsRead,
    refetch,
  };
}

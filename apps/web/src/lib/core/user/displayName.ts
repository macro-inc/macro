import { debounce } from '@core/util/debounce';

import { authServiceClient } from '@service-auth/client';
import { createEffect, createSignal } from 'solid-js';
import { createStore, unwrap } from 'solid-js/store';
import { type MacroId, macroIdToEmail } from './macroId';
import type { UserNameItem, UserNamePreviewFetcher } from './types';

/**
 * Initials from a structured name, falling back to the email's first letter.
 * Two letters when both names are present, otherwise one.
 */
export function getInitials(
  firstName: string,
  lastName: string,
  email: string
): string {
  const first = firstName.trim();
  const last = lastName.trim();

  if (first && last) {
    return (first[0] + last[0]).toUpperCase();
  }
  if (first) {
    return first[0].toUpperCase();
  }
  return email.substring(0, 1).toUpperCase();
}

/**
 * Initials from a free-form display name (split on whitespace into first/last
 * tokens), falling back to the email's first letter. For data sources that
 * carry a single name string rather than structured first/last fields.
 */
export function getInitialsFromName(
  name: string | null | undefined,
  email: string
): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const last = parts.length > 1 ? (parts.at(-1) ?? '') : '';
  return getInitials(parts[0] ?? '', last, email);
}

const DEFAULT_CACHE_TIME_SECONDS = 60 * 10;

type DisplayNameStore = Record<string, UserNameItem>;

const [userDisplayNames, setUserDisplayNames] = createStore<DisplayNameStore>(
  {}
);

const [displayNameFetchQueue, setDisplayNameFetchQueue] = createSignal<
  string[]
>([]);

/** Adds items to fetch queue and schedules processing */
function queueItemsForFetch(items: string[]) {
  setDisplayNameFetchQueue((prev) => [...prev, ...items]);
}

type DisplayNameOptions = {
  emailFallback?: 'full' | 'local-part';
};

function formatEmailFallback(email: string, options?: DisplayNameOptions) {
  if (options?.emailFallback !== 'local-part') return email;
  return email.split('@')[0] || email;
}

function defaultNameTransform(
  item: UserNameItem,
  options?: DisplayNameOptions
): string {
  // TODO: UserNameItem needs to be ported to use MacroId
  const email = macroIdToEmail(item.id as MacroId);

  if (item.loading) return formatEmailFallback(email, options);

  if (item.lastName || item.firstName) {
    let name: string[] = [];

    // HACK: filter out default field "N/A"
    if (item.firstName && item.firstName !== 'N/A') {
      name.push(item.firstName);
    }

    // HACK: filter out default field "N/A"
    if (item.lastName && item.lastName !== 'N/A') {
      name.push(item.lastName);
    }

    if (name.length === 0) return formatEmailFallback(email, options);

    let nameStringified = name.join(' ');
    return nameStringified;
  }

  return formatEmailFallback(email, options);
}

async function fetchDisplayNames(ids: string[]): Promise<UserNameItem[]> {
  const result = await authServiceClient.getUserNamesWithEmail({
    user_ids: ids,
  });
  if (result.isErr()) {
    console.error('Failed to fetch user display names');
    return [];
  }

  const data = result.value;
  return data.names.map((name) => {
    return {
      _createdAt: new Date(),
      id: name.id,
      firstName: name.first_name as string,
      lastName: name.last_name as string,
      loading: false,
    };
  });
}

const processFetchQueue = debounce(async () => {
  const items = displayNameFetchQueue();
  if (items.length === 0) return;

  setDisplayNameFetchQueue([]);
  await batchFetchNames(items);
}, 50);

async function batchFetchNames(ids: string[]) {
  const [nameResults] = await Promise.all([
    ids.length > 0 ? fetchDisplayNames(ids) : Promise.resolve([]),
  ]);

  const updates = nameResults.reduce((acc, result) => {
    acc[result.id] = result;
    return acc;
  }, {} as DisplayNameStore);

  setUserDisplayNames((prev) => ({ ...prev, ...updates }));
}

/** Shared hook that handles caching/fetching and returns the underlying UserNameItem */
function useUserNameItem(id: MacroId) {
  const cached = userDisplayNames[id];
  const cacheExpired =
    cached &&
    !cached.loading &&
    Date.now() - cached._createdAt.getTime() >
      DEFAULT_CACHE_TIME_SECONDS * 1000;

  if (!cached || cacheExpired) {
    setUserDisplayNames(id, {
      loading: true,
      _createdAt: new Date(),
      id: id,
    });
    queueItemsForFetch([id]);
  }

  createEffect(() => {
    const queue = displayNameFetchQueue();
    if (queue.length > 0) {
      processFetchQueue();
    }
  });

  const getItem = () => unwrap(userDisplayNames[id]);

  const refetch = () => {
    setUserDisplayNames(id, {
      loading: true,
      _createdAt: new Date(),
      id: id,
    });
    queueItemsForFetch([id]);
  };

  const mutate = (value: UserNameItem) => {
    setUserDisplayNames(id, value);
  };

  return { getItem, refetch, mutate };
}

type DisplayNameParts = {
  firstName: () => string;
  lastName: () => string;
  fullName: () => string;
  refetch: () => void;
};

export function useDisplayNameParts(
  id: MacroId | undefined | null,
  options?: DisplayNameOptions
): DisplayNameParts {
  if (!id) {
    return {
      firstName: () => '',
      lastName: () => '',
      fullName: () => '',
      refetch: () => {},
    };
  }

  const { getItem, refetch } = useUserNameItem(id);

  const firstName = () => {
    const item = getItem();
    if (item?.loading) return '';
    const name = item?.firstName;
    return name && name !== 'N/A' ? name : '';
  };

  const lastName = () => {
    const item = getItem();
    if (item?.loading) return '';
    const name = item?.lastName;
    return name && name !== 'N/A' ? name : '';
  };

  const fullName = () => defaultNameTransform(getItem(), options);

  return { firstName, lastName, fullName, refetch };
}

export function useDisplayName(
  id: MacroId | undefined | null,
  options?: DisplayNameOptions
): UserNamePreviewFetcher {
  if (!id) {
    return [
      () => '',
      {
        refetch: () => {},
        mutate: (_value: UserNameItem) => {},
      },
    ];
  }

  const { getItem, refetch, mutate } = useUserNameItem(id);

  const accessor = () => defaultNameTransform(getItem(), options);

  return [accessor, { refetch, mutate }];
}

/**
 * Seeds the display name cache with mock user data.
 * Useful for debug views and testing.
 */
export function seedMockDisplayNames(
  users: Array<{ id: string; firstName?: string; lastName?: string }>
) {
  for (const user of users) {
    setUserDisplayNames(user.id, {
      _createdAt: new Date(),
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      loading: false,
    });
  }
}

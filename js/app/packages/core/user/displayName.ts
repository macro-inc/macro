import { debounce } from '@core/util/debounce';
import { isErr } from '@core/util/maybeResult';
import { authServiceClient } from '@service-auth/client';
import { createEffect, createSignal } from 'solid-js';
import { createStore, unwrap } from 'solid-js/store';
import { type MacroId, macroIdToEmail } from './macroId';
import type { UserNameItem, UserNamePreviewFetcher } from './types';

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

function defaultNameTransform(item: UserNameItem): string {
  // TODO: UserNameItem needs to be ported to use MacroId
  const email = macroIdToEmail(item.id as MacroId);

  if (item.loading) return email;

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

    if (name.length === 0) return email;

    let nameStringified = name.join(' ');
    return nameStringified;
  }

  return email;
}

async function fetchDisplayNames(ids: string[]): Promise<UserNameItem[]> {
  const result = await authServiceClient.getUserNamesWithEmail({
    user_ids: ids,
  });
  if (isErr(result)) {
    console.error('Failed to fetch user display names');
    return [];
  }

  const [, data] = result;
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

export type DisplayNameParts = {
  firstName: () => string;
  lastName: () => string;
  fullName: () => string;
  refetch: () => void;
};

export function useDisplayNameParts(
  id: MacroId | undefined | null
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

  const fullName = () => defaultNameTransform(getItem());

  return { firstName, lastName, fullName, refetch };
}

export function useDisplayName(
  id: MacroId | undefined | null
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

  const accessor = () => defaultNameTransform(getItem());

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

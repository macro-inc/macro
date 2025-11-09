import { debounce } from '@core/util/debounce';
import { isErr } from '@core/util/maybeResult';
import { authServiceClient } from '@service-auth/client';
import { createEffect, createSignal } from 'solid-js';
import { createStore, unwrap } from 'solid-js/store';
import type { UserNameItem, UserNamePreviewFetcher } from './types';
import { idToEmail } from './util';

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
  const email = idToEmail(item.id);

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
  const result = await authServiceClient.getUserNames({ user_ids: ids });
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

  const updates: DisplayNameStore = {};

  [...nameResults].forEach((result) => {
    updates[result.id] = result;
  });

  setUserDisplayNames((prev) => ({ ...prev, ...updates }));
}

export function useDisplayName(
  id: string | undefined | null
): UserNamePreviewFetcher {
  if (!id) {
    const dummy_accessor = () => {
      return '';
    };

    const dummy_controls = {
      refetch: () => {},
      mutate: (_value: UserNameItem) => {},
    };

    return [dummy_accessor, dummy_controls];
  }
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

  const accessor = () => {
    const _item = unwrap(userDisplayNames[id]);
    return defaultNameTransform(_item);
  };

  const controls = {
    refetch: () => {
      setUserDisplayNames(id, {
        loading: true,
        _createdAt: new Date(),
        id: id,
      });
      queueItemsForFetch([id]);
    },
    mutate: (value: UserNameItem) => {
      setUserDisplayNames(id, value);
    },
  };

  return [accessor, controls];
}

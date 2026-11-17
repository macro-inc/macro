import { debounce } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';

import { authServiceClient } from '@service-auth/client';
import { until } from '@solid-primitives/promise';
import {
  type Accessor,
  createEffect,
  createRoot,
  createSignal,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { z } from 'zod';

type ProfilePictureStore = Record<string, ProfilePictureItem>;
const [userProfilePictures, setUserProfilePictures] =
  createStore<ProfilePictureStore>({});

const DEFAULT_CACHE_TIME_SECONDS = 60 * 10;

export type ProfilePictureItem = {
  _createdAt: Date;
  id: string;
  url?: string;
  loading: boolean;
};

const [profilePictureFetchQueue, setProfilePictureFetchQueue] = createSignal<
  string[]
>([]);
createRoot(() =>
  createEffect(() => {
    const queue = profilePictureFetchQueue();
    if (queue.length > 0) {
      processFetchQueue();
    }
  })
);

/** Adds items to fetch queue and schedules processing */
function queueItemsForFetch(items: string[]) {
  setProfilePictureFetchQueue((prev) => [...prev, ...items]);
}

function defaultUrlTransform(item: ProfilePictureItem): string | undefined {
  if (item.loading) return;

  return item.url;
}

async function fetchProfilePictures(
  ids: string[]
): Promise<ProfilePictureItem[]> {
  const result = await authServiceClient.postProfilePictures({
    user_id_list: ids,
  });
  if (result.isErr()) {
    console.error('Failed to fetch user profile pictures');
    // Mark as not-loading with an expired timestamp so the next access
    // retries the fetch instead of getting stuck forever (see
    // `useProfilePictureUrl`'s `cacheExpired` check).
    return ids.map((id) => ({
      _createdAt: new Date(0),
      id,
      loading: false,
    }));
  }

  // The server omits users without a picture; they're loaded too, with no url,
  // or they'd stay `loading` (and never refetch) for the rest of the session.
  const urls = new Map(result.value.pictures.map(({ id, url }) => [id, url]));
  const fetchedAt = new Date();
  return ids.map((id) => ({
    _createdAt: fetchedAt,
    id,
    url: urls.get(id),
    loading: false,
  }));
}

type ProfilePictureUrlFetcher = [
  Accessor<string | undefined>,
  {
    refetch: () => void;
    mutate: (value: ProfilePictureItem) => void;
  },
];

const processFetchQueue = debounce(async () => {
  const items = profilePictureFetchQueue();
  if (items.length === 0) return;

  setProfilePictureFetchQueue([]);
  await batchFetchProfilePictures(items);
}, 50);

async function batchFetchProfilePictures(ids: string[]) {
  const [nameResults] = await Promise.all([
    ids.length > 0 ? fetchProfilePictures(ids) : Promise.resolve([]),
  ]);

  const updates: ProfilePictureStore = {};

  [...nameResults].forEach((result) => {
    updates[result.id] = result;
  });

  setUserProfilePictures((prev) => ({ ...prev, ...updates }));
}

export function useProfilePictureUrl(id?: string): ProfilePictureUrlFetcher {
  if (!id) {
    const dummy_accessor = () => {
      return '';
    };

    const dummy_controls = {
      refetch: () => {},
      mutate: (_value: ProfilePictureItem) => {},
    };

    return [dummy_accessor, dummy_controls];
  }
  const cached = userProfilePictures[id];
  const cacheExpired =
    cached &&
    !cached.loading &&
    Date.now() - cached._createdAt.getTime() >
      DEFAULT_CACHE_TIME_SECONDS * 1000;

  if (!cached || cacheExpired) {
    setUserProfilePictures(id, {
      loading: true,
      _createdAt: new Date(),
      id: id,
    });
    queueItemsForFetch([id]);
  }

  const accessor = () => {
    const item = userProfilePictures[id];
    return defaultUrlTransform(item);
  };

  const controls = {
    refetch: () => {
      setUserProfilePictures(id, {
        loading: true,
        _createdAt: new Date(),
        id: id,
      });
      queueItemsForFetch([id]);
    },
    mutate: (value: ProfilePictureItem) => {
      setUserProfilePictures(id, value);
    },
  };

  return [accessor, controls];
}

/** A user's profile picture URL from the shared cache, fetched if needed. */
export async function getProfilePictureUrl(
  id: string
): Promise<string | undefined> {
  useProfilePictureUrl(id);
  const item = await until(() => {
    const item = userProfilePictures[id];
    return item && !item.loading ? item : undefined;
  });
  return item.url;
}

/** Most user ids sent in one refresh request. */
const REFRESH_BATCH_SIZE = 100;

/**
 * Refetches the given users' pictures, batched. The old URL stays visible until
 * the new one arrives, and a failed batch keeps its URLs. An entry written
 * after a batch was sent is newer than its response, so it is left alone.
 */
async function refreshPictures(ids: string[]): Promise<void> {
  for (let start = 0; start < ids.length; start += REFRESH_BATCH_SIZE) {
    const batch = ids.slice(start, start + REFRESH_BATCH_SIZE);
    const sentAt = new Date();
    const result = await authServiceClient.postProfilePictures({
      user_id_list: batch,
    });
    if (result.isErr()) {
      console.error('Failed to refresh user profile pictures');
      continue;
    }

    const urls = new Map(result.value.pictures.map(({ id, url }) => [id, url]));
    const fetchedAt = new Date();
    for (const id of batch) {
      const current = userProfilePictures[id];
      if (current && current._createdAt > sentAt) continue;
      setUserProfilePictures(id, {
        _createdAt: fetchedAt,
        id,
        url: urls.get(id),
        loading: false,
      });
    }
  }
}

/**
 * Refetches a user's picture only when it is already cached, so pictures
 * nobody is showing are never fetched. The old URL stays visible until the new
 * one arrives, and a failed refetch keeps it.
 */
export async function refreshProfilePicture(userId: string): Promise<void> {
  if (!userProfilePictures[userId]) return;
  await refreshPictures([userId]);
}

/**
 * Refetches every cached picture. Run when the connection gateway reconnects:
 * `user_picture_changed` frames sent while the socket was down are never
 * replayed, and mounted avatars don't re-check the cache TTL, so a missed frame
 * would otherwise stay stale until a reload.
 */
export async function refreshCachedProfilePictures(): Promise<void> {
  await refreshPictures(Object.keys(userProfilePictures));
}

let resync: Promise<void> | undefined;
let resyncAgain = false;

async function runResync(): Promise<void> {
  do {
    resyncAgain = false;
    await refreshCachedProfilePictures();
  } while (resyncAgain);
}

/**
 * Connection-gateway reconnect listener for
 * {@link refreshCachedProfilePictures}. Overlapping reconnects share one sweep,
 * plus one more pass if a reconnect landed while it ran.
 */
export function refreshCachedProfilePicturesOnReconnect(): void {
  if (resync) {
    resyncAgain = true;
    return;
  }
  resync = runResync().finally(() => {
    resync = undefined;
  });
  fireAndForget(resync, 'profile-pictures-resync-on-reconnect');
}

const userPictureChangedSchema = z.object({ user_id: z.string().min(1) });

/** Handles the gateway's `user_picture_changed` message; malformed payloads are ignored. */
export function handleUserPictureChanged(payload: unknown): void {
  const parsed = userPictureChangedSchema.safeParse(payload);
  if (!parsed.success) return;

  fireAndForget(
    refreshProfilePicture(parsed.data.user_id),
    'user-picture-changed'
  );
}

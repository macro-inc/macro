import { debounce } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';

import { Telemetry } from '@macro-inc/observability';
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
  await fetchPictures(items);
}, 50);

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

/** Most user ids sent in one request. */
const FETCH_BATCH_SIZE = 100;

/**
 * Fetches the given users' pictures, batched, and returns how many batches
 * failed. Every fetch (first load, TTL refetch, live update, reconnect sweep)
 * writes through here, so entries are versioned by when their request was
 * sent and responses apply in send order however they arrive: one never
 * overwrites an entry written after its request was sent. The server omits
 * users without a picture; they're loaded too, with no url.
 *
 * A failed batch keeps cached URLs; entries still `loading` are marked loaded
 * with an expired timestamp so the next access retries instead of waiting
 * forever (see `useProfilePictureUrl`'s `cacheExpired` check).
 */
async function fetchPictures(ids: string[]): Promise<number> {
  let failed = 0;
  for (let start = 0; start < ids.length; start += FETCH_BATCH_SIZE) {
    const batch = ids.slice(start, start + FETCH_BATCH_SIZE);
    const sentAt = new Date();
    const result = await authServiceClient.postProfilePictures({
      user_id_list: batch,
    });
    const isNewer = (id: string) => {
      const current = userProfilePictures[id];
      return current !== undefined && current._createdAt > sentAt;
    };

    if (result.isErr()) {
      console.error('Failed to fetch user profile pictures');
      failed += 1;
      for (const id of batch) {
        if (isNewer(id) || !userProfilePictures[id]?.loading) continue;
        setUserProfilePictures(id, {
          _createdAt: new Date(0),
          id,
          loading: false,
        });
      }
      continue;
    }

    const urls = new Map(result.value.pictures.map(({ id, url }) => [id, url]));
    for (const id of batch) {
      if (isNewer(id)) continue;
      setUserProfilePictures(id, {
        _createdAt: sentAt,
        id,
        url: urls.get(id),
        loading: false,
      });
    }
  }
  return failed;
}

/**
 * Refetches a user's picture only when it is already cached, so pictures
 * nobody is showing are never fetched. The old URL stays visible until the new
 * one arrives, and a failed refetch keeps it.
 */
export async function refreshProfilePicture(userId: string): Promise<void> {
  if (!userProfilePictures[userId]) return;
  await fetchPictures([userId]);
}

/**
 * Refetches every cached picture. Run when the connection gateway reconnects:
 * `user_picture_changed` frames sent while the socket was down are never
 * replayed, and mounted avatars don't re-check the cache TTL, so a missed frame
 * would otherwise stay stale until a reload.
 */
export async function refreshCachedProfilePictures(): Promise<void> {
  await Telemetry.span('profile_pictures.resync', async (span) => {
    const ids = Object.keys(userProfilePictures);
    span.setAttr('profile_pictures.resync.user_count', ids.length);
    span.setAttr(
      'profile_pictures.resync.batch_count',
      Math.ceil(ids.length / FETCH_BATCH_SIZE)
    );
    const failed = await fetchPictures(ids);
    span.setAttr('profile_pictures.resync.failed_batches', failed);
  });
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

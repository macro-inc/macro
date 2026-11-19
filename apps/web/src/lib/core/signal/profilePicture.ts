import { debounce } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import { type AgentFace, parseAgentFace } from '@macro-inc/agent-faces';
import { queryAccountSession } from '@queries/auth/account-scope';

import { authServiceClient } from '@service-auth/client';
import type { UserProfilePicture } from '@service-auth/generated/schemas/userProfilePicture';
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
  /** The user's saved face; it is drawn instead of `url`, which is its PNG. */
  face?: AgentFace;
  loading: boolean;
};

/** A cache entry from one row of `POST /user/profile_pictures`. */
function pictureItem(picture: UserProfilePicture): ProfilePictureItem {
  // A face-only agent may have no PNG yet, so the url can be null.
  const face = parseAgentFace(picture.avatar_face);
  return {
    _createdAt: new Date(),
    id: picture.id,
    url: picture.url ?? undefined,
    face,
    loading: false,
  };
}

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

  return result.value.pictures.map(pictureItem);
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

/**
 * The newest read of each user's picture. A response writes only the users it
 * is still the newest read for, so a read that started before an avatar save
 * (or before another refresh) can't put the old picture back.
 */
const newestRead: Record<string, number> = {};
let reads = 0;

function startRead(ids: string[]): number {
  reads += 1;
  for (const id of ids) newestRead[id] = reads;
  return reads;
}

async function batchFetchProfilePictures(ids: string[]) {
  const accountSession = queryAccountSession();
  const read = startRead(ids);
  const requestedAt = ids.map((id) => userProfilePictures[id]?._createdAt);
  const [nameResults] = await Promise.all([
    ids.length > 0 ? fetchProfilePictures(ids) : Promise.resolve([]),
  ]);

  if (queryAccountSession() !== accountSession) {
    // Retire only this batch's pending entries; a newer reader may already
    // have started another request for the same person in the new session.
    ids.forEach((id, index) => {
      if (userProfilePictures[id]?._createdAt !== requestedAt[index]) return;
      setUserProfilePictures(id, { loading: false, _createdAt: new Date(0) });
    });
    return;
  }

  // The response leaves out users with no picture; they are loaded too.
  const updates: ProfilePictureStore = {};
  for (const id of ids) {
    updates[id] = {
      _createdAt: new Date(),
      id,
      loading: false,
      url: undefined,
      face: undefined,
    };
  }

  [...nameResults].forEach((result) => {
    updates[result.id] = result;
  });
  for (const id of Object.keys(updates)) {
    if (newestRead[id] !== read) delete updates[id];
  }

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

/**
 * A user's cache entry, read reactively; `undefined` until
 * `useProfilePictureUrl` has asked for it.
 */
export function profilePictureItem(id: string): ProfilePictureItem | undefined {
  return userProfilePictures[id];
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

/**
 * Refetches a user's picture only when it is already cached, so pictures
 * nobody is showing are never fetched. The old URL stays visible until the new
 * one arrives, and a failed refetch keeps it.
 */
export async function refreshProfilePicture(userId: string): Promise<void> {
  const cached = userProfilePictures[userId];
  if (!cached) return;

  const accountSession = queryAccountSession();
  const read = startRead([userId]);
  const result = await authServiceClient.postProfilePictures({
    user_id_list: [userId],
  });
  if (result.isErr()) {
    console.error('Failed to refresh user profile picture');
    // A batch this refresh superseded left the entry loading: retry later.
    if (newestRead[userId] === read && userProfilePictures[userId]?.loading)
      setUserProfilePictures(userId, {
        loading: false,
        _createdAt: new Date(0),
      });
    return;
  }

  if (queryAccountSession() !== accountSession) return;
  if (newestRead[userId] !== read) return;
  const picture = result.value.pictures.find(({ id }) => id === userId);
  setUserProfilePictures(
    userId,
    picture
      ? pictureItem(picture)
      : {
          _createdAt: new Date(),
          id: userId,
          loading: false,
          url: undefined,
          face: undefined,
        }
  );
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

import { fireAndForget } from '@core/util/fireAndForget';

import { Telemetry } from '@macro-inc/observability';
import { authServiceClient } from '@service-auth/client';
import { until } from '@solid-primitives/promise';
import { AsyncBatcher } from '@tanstack/pacer';
import { type Accessor, getOwner, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import { z } from 'zod';

export type ProfilePictureItem = {
  _createdAt: Date;
  id: string;
  url?: string;
  loading: boolean;
};

/**
 * A cached picture plus the version it was written at: the `clock` value when
 * its request was sent (or when it was set locally). Versions order every
 * write, so a response never overwrites an entry written after its request was
 * sent, and an entry is stale when it was written before the last
 * invalidation.
 */
type ProfilePictureEntry = ProfilePictureItem & { version: number };

const [userProfilePictures, setUserProfilePictures] = createStore<
  Record<string, ProfilePictureEntry>
>({});

const DEFAULT_CACHE_TIME_SECONDS = 60 * 10;

/** Most user ids sent in one request. */
const FETCH_BATCH_SIZE = 100;

/** How long fetches requested together wait to share a request. */
const FETCH_BATCH_WAIT_MS = 50;

/**
 * Upper bound of the random delay before mounted avatars refetch after a
 * reconnect, so clients a gateway deploy reconnects together don't all ask at
 * once.
 */
const RECONNECT_REFETCH_MAX_JITTER_MS = 2_000;

/** Source of entry versions; see {@link ProfilePictureEntry}. */
let clock = 0;
/** Entries with `version <= invalidatedAt` are stale. */
let invalidatedAt = 0;

type PendingFetch = {
  promise: Promise<boolean>;
  resolve: (ok: boolean) => void;
};

/** Ids waiting for the batcher, each with the promise its request settles. */
const queued = new Map<string, PendingFetch>();
/** Version of the latest request sent for each id still waiting on a response. */
const inFlight = new Map<string, number>();
/** How many mounted avatars show each id. */
const mountCounts = new Map<string, number>();

const batcher = new AsyncBatcher<string>(fetchBatch, {
  wait: FETCH_BATCH_WAIT_MS,
  maxSize: FETCH_BATCH_SIZE,
  throwOnError: false,
});

function pendingFetch(): PendingFetch {
  let resolve!: (ok: boolean) => void;
  const promise = new Promise<boolean>((r) => (resolve = r));
  return { promise, resolve };
}

/**
 * Queues one fetch for `id`, shared with any fetch already queued for it.
 * Resolves `true` once the response is applied, `false` if the request failed.
 */
function enqueue(id: string): Promise<boolean> {
  const existing = queued.get(id);
  if (existing) return existing.promise;
  const pending = pendingFetch();
  queued.set(id, pending);
  fireAndForget(batcher.addItem(id), 'profile-pictures-fetch');
  return pending.promise;
}

function isStale(entry: ProfilePictureEntry): boolean {
  return entry.version <= invalidatedAt;
}

function isExpired(entry: ProfilePictureEntry): boolean {
  return (
    !entry.loading &&
    Date.now() - entry._createdAt.getTime() > DEFAULT_CACHE_TIME_SECONDS * 1000
  );
}

/** Whether `id` needs a fetch that isn't already queued or in flight. */
function needsFetch(id: string): boolean {
  if (queued.has(id)) return false;
  const sent = inFlight.get(id);
  // A request sent after the last invalidation will bring a fresh picture.
  if (sent !== undefined && sent > invalidatedAt) return false;
  const entry = userProfilePictures[id];
  return !entry || isStale(entry) || isExpired(entry);
}

/**
 * Fetches `id` if it's missing, stale or expired. A missing user gets a
 * loading entry; a cached picture stays on screen until the new one arrives.
 */
function ensureFresh(id: string): Promise<boolean> | undefined {
  if (!needsFetch(id)) return queued.get(id)?.promise;
  if (!userProfilePictures[id]) {
    setUserProfilePictures(id, {
      id,
      loading: true,
      _createdAt: new Date(),
      version: 0,
    });
  }
  return enqueue(id);
}

/**
 * Sends one batch. The only writer of fetched pictures: entries are versioned
 * by when their request was sent, so responses apply in send order however
 * they arrive. The server omits users without a picture; they're loaded too,
 * with no url.
 *
 * A failed request keeps cached URLs (still stale, so the next mount retries);
 * entries still `loading` are marked loaded with an expired timestamp so the
 * next access retries instead of waiting forever.
 */
async function fetchBatch(ids: string[]): Promise<void> {
  const version = ++clock;
  const waiting: PendingFetch[] = [];
  for (const id of ids) {
    const pending = queued.get(id);
    if (pending) waiting.push(pending);
    queued.delete(id);
    inFlight.set(id, version);
  }

  let ok = false;
  try {
    const result = await authServiceClient.postProfilePictures({
      user_id_list: ids,
    });
    const isNewer = (id: string) =>
      (userProfilePictures[id]?.version ?? -1) > version;

    if (result.isErr()) {
      console.error('Failed to fetch user profile pictures');
      for (const id of ids) {
        if (isNewer(id) || !userProfilePictures[id]?.loading) continue;
        setUserProfilePictures(id, {
          id,
          loading: false,
          _createdAt: new Date(0),
          version: 0,
        });
      }
      return;
    }

    ok = true;
    const urls = new Map(result.value.pictures.map(({ id, url }) => [id, url]));
    for (const id of ids) {
      if (isNewer(id)) continue;
      setUserProfilePictures(id, {
        id,
        url: urls.get(id),
        loading: false,
        _createdAt: new Date(),
        version,
      });
    }
  } finally {
    for (const id of ids) {
      if (inFlight.get(id) === version) inFlight.delete(id);
    }
    for (const pending of waiting) pending.resolve(ok);
  }
}

function trackMount(id: string): void {
  if (!getOwner()) return;
  mountCounts.set(id, (mountCounts.get(id) ?? 0) + 1);
  onCleanup(() => {
    const count = (mountCounts.get(id) ?? 1) - 1;
    if (count > 0) mountCounts.set(id, count);
    else mountCounts.delete(id);
  });
}

function defaultUrlTransform(
  item: ProfilePictureItem | undefined
): string | undefined {
  if (!item || item.loading) return;

  return item.url;
}

type ProfilePictureUrlFetcher = [
  Accessor<string | undefined>,
  {
    refetch: () => void;
    mutate: (value: ProfilePictureItem) => void;
  },
];

/**
 * A user's profile picture URL, fetched if missing, stale or expired. While
 * the caller is mounted, a reconnect refetches it (see
 * {@link invalidateProfilePicturesOnReconnect}).
 */
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
  trackMount(id);
  fireAndForget(ensureFresh(id), 'profile-picture-mount');

  const accessor = () => defaultUrlTransform(userProfilePictures[id]);

  const controls = {
    refetch: () => {
      fireAndForget(enqueue(id), 'profile-picture-refetch');
    },
    mutate: (value: ProfilePictureItem) => {
      setUserProfilePictures(id, { ...value, version: ++clock });
    },
  };

  return [accessor, controls];
}

/** A user's profile picture URL from the shared cache, fetched if needed. */
export async function getProfilePictureUrl(
  id: string
): Promise<string | undefined> {
  await ensureFresh(id);
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
  if (!userProfilePictures[userId]) return;
  await enqueue(userId);
}

let reconnectRefetchScheduled = false;

/**
 * Refetches the mounted avatars that are still stale, in batched requests.
 * Unmounted entries wait for their next mount or read.
 */
async function refetchMountedStale(): Promise<void> {
  await Telemetry.span('profile_pictures.reconnect_refetch', async (span) => {
    const ids = [...mountCounts.keys()].filter(needsFetch);
    span.setAttr('profile_pictures.mounted_count', mountCounts.size);
    span.setAttr('profile_pictures.refetch_count', ids.length);
    const results = await Promise.all(ids.map(enqueue));
    span.setAttr(
      'profile_pictures.failed_count',
      results.filter((ok) => !ok).length
    );
  });
}

/**
 * Connection-gateway reconnect listener. `user_picture_changed` frames sent
 * while the socket was down are never replayed, so every cached picture is
 * marked stale (one counter bump, no network). Mounted avatars refetch after a
 * short random delay, batched; everything else refetches when it next mounts
 * or is read. Reconnects while a refetch is scheduled share it.
 */
export function invalidateProfilePicturesOnReconnect(): void {
  invalidatedAt = ++clock;
  if (reconnectRefetchScheduled) return;
  reconnectRefetchScheduled = true;
  setTimeout(() => {
    reconnectRefetchScheduled = false;
    fireAndForget(refetchMountedStale(), 'profile-pictures-reconnect-refetch');
  }, Math.random() * RECONNECT_REFETCH_MAX_JITTER_MS);
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

import { debounce } from '@core/util/debounce';
import { isErr } from '@core/util/maybeResult';
import { authServiceClient } from '@service-auth/client';
import {
  type Accessor,
  createEffect,
  createRoot,
  createSignal,
} from 'solid-js';
import { createStore } from 'solid-js/store';

type ProfilePictureStore = Record<string, ProfilePictureItem>;
export const [userProfilePictures, setUserProfilePictures] =
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
  if (isErr(result)) {
    console.error('Failed to fetch user profile pictures');
    return [];
  }

  const [, { pictures }] = result;
  return pictures.map(({ id, url }) => ({
    _createdAt: new Date(),
    id,
    url,
    loading: false,
  }));
}

export type ProfilePictureUrlFetcher = [
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

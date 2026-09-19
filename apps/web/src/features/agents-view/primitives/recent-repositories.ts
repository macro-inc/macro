import { makePersistedState } from '@app/lib/persistence';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { type Accessor, createSignal } from 'solid-js';
import {
  parseRepositoryTouches,
  type RepositoryTouch,
  recentRepositoryUrls,
  touchRepository,
} from '../core/repository';

/** How many distinct repositories to keep; matches the soup conversation page. */
const RECENT_REPOSITORY_LIMIT = 100;

export type RecentRepositories = {
  urls: () => string[];
  /** A use from this composer or an opened session, at now. */
  remember: (url: string) => void;
  /**
   * A use learned from an existing session. Only moves the repository if
   * this timestamp is newer than what we already have.
   */
  observe: (url: string, at: number) => void;
};

type UserId = string | undefined | Accessor<string | undefined>;

const stores = new Map<string, RecentRepositories>();

function readUserId(userId: UserId): string | undefined {
  return typeof userId === 'function' ? userId() : userId;
}

function storeFor(userId: string | undefined): RecentRepositories {
  const key = userId ?? '';
  const existing = stores.get(key);
  if (existing) return existing;
  const created = createRecentRepositoriesStore(userId);
  stores.set(key, created);
  return created;
}

/**
 * Repositories the signed-in user has used, newest first. Shared across the
 * composer and conversation list so opening a session and picking in the
 * dropdown agree on order. Looks up the current user on each read/write so a
 * user switch without a remount cannot keep writing the previous key.
 */
export function createRecentRepositories(userId: UserId): RecentRepositories {
  const currentUserId = () => readUserId(userId);
  return {
    urls: () => storeFor(currentUserId()).urls(),
    remember: (url) => storeFor(currentUserId()).remember(url),
    observe: (url, at) => storeFor(currentUserId()).observe(url, at),
  };
}

/** Drops in-memory stores so tests do not leak recents across cases. */
export function resetRecentRepositoriesForTests() {
  stores.clear();
}

function createRecentRepositoriesStore(
  userId: string | undefined
): RecentRepositories {
  const storage = createUserScopedStorage('agents-view-repositories-v1');
  const [touches, setTouches] = makePersistedState(
    createSignal<RepositoryTouch[]>([]),
    {
      storages: {
        restore: () => {
          if (!userId) return;
          return parseRepositoryTouches(
            JSON.parse(storage.read(userId) ?? '[]')
          ).slice(0, RECENT_REPOSITORY_LIMIT);
        },
        write: (value) => {
          if (userId) storage.write(userId, JSON.stringify(value));
        },
      },
    }
  );

  const record = (url: string, at: number) =>
    setTouches((previous) =>
      touchRepository(previous, url, at).slice(0, RECENT_REPOSITORY_LIMIT)
    );

  return {
    urls: () => recentRepositoryUrls(touches()),
    remember: (url: string) => record(url, Date.now()),
    observe: (url: string, at: number) => record(url, at),
  };
}

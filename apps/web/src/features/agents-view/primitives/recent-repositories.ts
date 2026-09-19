import { makePersistedState } from '@app/lib/persistence';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createSignal } from 'solid-js';
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

const stores = new Map<string, RecentRepositories>();

/**
 * Repositories the signed-in user has used, newest first. Shared across the
 * composer and conversation list so opening a session and picking in the
 * dropdown agree on order.
 */
export function createRecentRepositories(
  userId: string | undefined
): RecentRepositories {
  const key = userId ?? '';
  const existing = stores.get(key);
  if (existing) return existing;
  const created = createRecentRepositoriesStore(userId);
  stores.set(key, created);
  return created;
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

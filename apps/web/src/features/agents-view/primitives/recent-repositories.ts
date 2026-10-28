import { makePersistedState } from '@app/lib/persistence';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createSignal } from 'solid-js';

const RECENT_REPOSITORY_LIMIT = 8;

/**
 * Repositories handed to coders from this composer, newest first and scoped
 * to the signed-in user. The picker offers listed recents ahead of the rest
 * of the GitHub App listing. A new conversation still starts on Automatic.
 */
export function createRecentRepositories(userId: string | undefined) {
  const storage = createUserScopedStorage('agents-view-repositories-v1');
  const [urls, setUrls] = makePersistedState(createSignal<string[]>([]), {
    storages: {
      restore: () => {
        if (!userId) return;
        const stored: unknown = JSON.parse(storage.read(userId) ?? '[]');
        if (!Array.isArray(stored)) return;
        return stored
          .filter((url): url is string => typeof url === 'string')
          .slice(0, RECENT_REPOSITORY_LIMIT);
      },
      write: (value) => {
        if (userId) storage.write(userId, JSON.stringify(value));
      },
    },
  });

  return {
    urls,
    remember: (url: string) =>
      setUrls((previous) =>
        [url, ...previous.filter((value) => value !== url)].slice(
          0,
          RECENT_REPOSITORY_LIMIT
        )
      ),
    forget: (url: string) =>
      setUrls((previous) => previous.filter((value) => value !== url)),
  };
}

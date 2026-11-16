import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { type Accessor, createSignal } from 'solid-js';
import { z } from 'zod';

/** Enough to cover a day's searches without turning the list into history. */
export const MAX_RECENT_EMAIL_SEARCHES = 8;

const STORAGE = createUserScopedStorage('macro:email:recent-searches:v1');
const recentSearchesSchema = z.array(z.string()).catch([]);

/** Puts `query` first, without repeating it, and drops the oldest. */
export function addRecentSearch(
  recent: readonly string[],
  query: string
): string[] {
  const added = query.trim();
  if (!added) return [...recent];

  const key = added.toLowerCase();
  return [
    added,
    ...recent.filter((entry) => entry.toLowerCase() !== key),
  ].slice(0, MAX_RECENT_EMAIL_SEARCHES);
}

/** Recent searches containing what is typed, leaving out the text itself. */
export function matchRecentSearches(
  recent: readonly string[],
  typed: string
): string[] {
  const needle = typed.trim().toLowerCase();

  return recent.filter((entry) => {
    const candidate = entry.toLowerCase();
    return candidate !== needle && candidate.includes(needle);
  });
}

function read(userId: string | undefined): string[] {
  if (!userId) return [];

  const raw = STORAGE.read(userId);
  if (raw === null) return [];

  try {
    return recentSearchesSchema
      .parse(JSON.parse(raw))
      .slice(0, MAX_RECENT_EMAIL_SEARCHES);
  } catch {
    return [];
  }
}

/**
 * The signed-in person's recent Email searches, kept in this browser. They
 * are per person, not per inbox: a search is rarely about one inbox only.
 */
export function createRecentEmailSearches(
  userId: Accessor<string | undefined>
) {
  const [recent, setRecent] = createSignal(read(userId()));

  return {
    recent,
    add: (query: string) => {
      const id = userId();
      // Another tab may have searched since this one read the list.
      const next = addRecentSearch(read(id), query);
      setRecent(next);
      if (id) STORAGE.write(id, JSON.stringify(next));
    },
  };
}

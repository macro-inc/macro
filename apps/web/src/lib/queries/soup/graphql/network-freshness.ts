/**
 * When this tab last had a network answer for a Soup list's first page, per
 * GraphQL client, so a reader with a `staleTime` can take the cached page
 * instead of fetching it again on every mount (TanStack's `staleTime` for the
 * REST list). Keyed by client: a new session's client starts with nothing.
 */
const MAX_ANSWERS_PER_CLIENT = 256;
const answers = new WeakMap<object, Map<string, number>>();

export function recordSoupNetworkAnswer(
  client: object,
  key: string,
  now = Date.now()
): void {
  let byKey = answers.get(client);
  if (!byKey) {
    byKey = new Map();
    answers.set(client, byKey);
  }
  // Reinsert so the oldest answer is the first one dropped.
  byKey.delete(key);
  byKey.set(key, now);
  if (byKey.size > MAX_ANSWERS_PER_CLIENT) {
    const oldest = byKey.keys().next().value;
    if (oldest !== undefined) byKey.delete(oldest);
  }
}

/** The network answered `key` on `client` less than `staleTime` ago. */
export function soupNetworkAnswerFresh(
  client: object,
  key: string,
  staleTime: number,
  now = Date.now()
): boolean {
  const answeredAt = answers.get(client)?.get(key);
  return answeredAt !== undefined && now - answeredAt < staleTime;
}

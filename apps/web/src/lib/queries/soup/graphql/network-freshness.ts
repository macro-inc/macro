/**
 * When this tab last had a network answer for a Soup list's first page, per
 * GraphQL client, so a reader with a `staleTime` can take the cached page
 * instead of fetching it again on every mount (TanStack's `staleTime` for the
 * REST list). Keyed by client: a new session's client starts with nothing.
 * A Soup write forgets every answer, as invalidating the REST lists marked
 * them stale: a list that mounts after it reads the server again.
 */
const MAX_ANSWERS_PER_CLIENT = 256;
type Answer = { at: number; writes: number };
const answers = new WeakMap<object, Map<string, Answer>>();
let writes = 0;

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
  byKey.set(key, { at: now, writes });
  if (byKey.size > MAX_ANSWERS_PER_CLIENT) {
    const oldest = byKey.keys().next().value;
    if (oldest !== undefined) byKey.delete(oldest);
  }
}

/** The network answered `key` on `client` less than `staleTime` ago, and no
 * Soup write happened since. */
export function soupNetworkAnswerFresh(
  client: object,
  key: string,
  staleTime: number,
  now = Date.now()
): boolean {
  const answer = answers.get(client)?.get(key);
  return (
    answer !== undefined &&
    answer.writes === writes &&
    now - answer.at < staleTime
  );
}

/** A write changed Soup lists: no earlier answer is fresh any more. */
export function forgetSoupNetworkAnswers(): void {
  writes += 1;
}

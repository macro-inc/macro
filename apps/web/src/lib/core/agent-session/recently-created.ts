/**
 * Sessions this tab created a moment ago.
 *
 * A session's id exists here before it exists on the server: the id is minted
 * on the client and the block opens against it (`pending-session.ts`), so the
 * first read can reach the harness within milliseconds of - sometimes ahead
 * of - the create that makes it real. A read the harness holds no grant for
 * is refused, and a refusal looks the same whether the grant is missing or
 * merely not there yet.
 *
 * An id in here says a refusal has an innocent reading available: this tab
 * created this session seconds ago, so "not yours" is far more likely to be
 * "not yet" than a session that was never ours. {@link AgentSession} retries
 * those instead of reporting a dead end.
 *
 * A wall-clock window rather than a handle passed down from the create on
 * purpose: the read that loses the race is often not the one the create
 * started. A reload, a second surface, or a navigation opens its own read
 * with no reference to the creating code path at all, and that read has to be
 * covered too.
 */

/**
 * How long after its create a session's refusal is read as "not yet".
 *
 * Long enough to cover a create still settling, short enough that a session
 * genuinely shared away from this viewer is reported honestly rather than
 * retried for a visibly long time.
 */
const GRACE_MS = 30_000;

const createdAt = new Map<string, number>();

/** Drop everything past the window, so the map tracks open tabs, not history. */
function prune(now: number): void {
  for (const [id, at] of createdAt) {
    if (now - at >= GRACE_MS) createdAt.delete(id);
  }
}

/** This tab's create for `id` has answered: it is ours, even if not readable yet. */
export function markSessionCreated(id: string): void {
  const now = Date.now();
  prune(now);
  createdAt.set(id, now);
}

/**
 * Whether this tab created `id` recently enough that a refusal should be
 * read as a create that has not landed.
 */
export function createdRecently(id: string): boolean {
  const at = createdAt.get(id);
  if (at === undefined) return false;
  if (Date.now() - at < GRACE_MS) return true;
  createdAt.delete(id);
  return false;
}

/**
 * Stop treating `id` as newly created.
 *
 * Called once a load has succeeded: the grant is demonstrably visible, so a
 * later refusal is a real one - access taken away rather than not yet given -
 * and must be reported rather than retried.
 */
export function forgetSessionCreated(id: string): void {
  createdAt.delete(id);
}

/**
 * Registry connecting realtime activity pushes to mounted entity-activity
 * queries. A leaf module: the push handler lives under the soup client (which
 * the query factories transitively import), so neither side can import the
 * other directly without a cycle.
 *
 * Cache inspection cannot recover an EntityActivity variant — `$limit` is an
 * argument of a deeper field than the inspectable `soup` selection and the
 * engine refuses the inspection outright — so instead each mounted query
 * registers its own revalidator, which also scopes refetches to panels that
 * are actually on screen.
 */

type EntityActivityRevalidator = (entityIds: ReadonlySet<string>) => void;

const revalidators = new Set<EntityActivityRevalidator>();

/** Registers a mounted entity-activity query; returns its unregister. */
export function registerEntityActivityRevalidator(
  revalidator: EntityActivityRevalidator
): () => void {
  revalidators.add(revalidator);
  return () => revalidators.delete(revalidator);
}

/** Fans a batch of pushed entity ids out to every mounted query. */
export function notifyEntityActivityPush(entityIds: ReadonlySet<string>): void {
  for (const revalidator of revalidators) revalidator(entityIds);
}

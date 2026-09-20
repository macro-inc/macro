import type { Client } from '@urql/core';

/** Null means every mounted activity query needs a fresh authorized read. */
export type ActivityInvalidation = ReadonlySet<string> | null;
type Revalidator = {
  client: () => Client | undefined;
  refresh: (entities: ActivityInvalidation) => Promise<unknown> | void;
};
const revalidators = new Set<Revalidator>();

/** Registers a mounted query, scoped to the client that owns its session. */
export function registerActivityRevalidator(
  revalidator: Revalidator
): () => void {
  revalidators.add(revalidator);
  return () => revalidators.delete(revalidator);
}

/** Each mounted observer recovers its own variables and pagination chain. */
export async function revalidateActivityQueries(
  client: Pick<Client, 'subscription' | 'query'>,
  entities: ActivityInvalidation
): Promise<void> {
  await Promise.all(
    [...revalidators].map(async (entry) => {
      if (!revalidators.has(entry) || entry.client() !== client) return;
      try {
        await entry.refresh(entities);
      } catch (error) {
        console.warn('Activity query revalidation failed', error);
      }
    })
  );
}

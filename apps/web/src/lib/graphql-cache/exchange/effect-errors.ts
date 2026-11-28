import type { CombinedError } from '@urql/core';

const EFFECT_FIELDS = new Set(['effect', 'effects']);

/**
 * Errors only inside the rows a write returns: the write itself committed, and
 * only reading its rows back failed. The server reports a row it could not
 * read back the same way, so a reply without its rows always says so.
 */
export function onlyEffectErrors(error: CombinedError | undefined): boolean {
  if (!error || error.networkError || error.graphQLErrors.length === 0)
    return false;
  return error.graphQLErrors.every((graphqlError) =>
    (graphqlError.path ?? [])
      .slice(1)
      .some((segment) => EFFECT_FIELDS.has(String(segment)))
  );
}

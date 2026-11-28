import type { CombinedError, OperationResult } from '@urql/core';

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

/**
 * A write the server committed whose reply lacks some of its rows: it carries
 * its data, and its only errors are under the rows. An HTTP 5xx is a failed
 * write even when it carries such errors.
 */
export function committedWithMissingRows(result: OperationResult): boolean {
  return (
    result.data != null &&
    (result.error?.response?.status ?? 0) < 500 &&
    onlyEffectErrors(result.error)
  );
}

/** The server committed this write: a clean reply, or one missing some rows. */
export function serverCommitted(result: OperationResult): boolean {
  return (
    result.data != null && (!result.error || committedWithMissingRows(result))
  );
}

import type { SoupUpdatesSubscription } from '@service-storage/graphql/generated/graphql';
import { refreshActiveGraphqlSoupQueries } from './active-queries';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

type SoupPatch = SoupUpdatesSubscription['soupUpdates'][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Mirrors `item_filter_index`: only a positive nil `CallId`, possibly AND-ed
 * with anything, proves a call filter selects nothing. */
function excludesCalls(ast: unknown): boolean {
  if (!isRecord(ast)) return false;
  const and = ast['&'];
  if (Array.isArray(and)) return and.some(excludesCalls);
  const literal = ast.l;
  return isRecord(literal) && literal.CallId === NIL_UUID;
}

/** Whether a Soup list's REST-shaped filter body can contain calls. */
export function listCanIncludeCalls(body: unknown): boolean {
  return isRecord(body) && !excludesCalls(body.callf);
}

function updatesCall(patch: SoupPatch): boolean {
  if (patch.__typename === 'GraphqlCacheDeletion') {
    return patch.graphqlTypeName === 'GraphqlSoupCall';
  }
  return (
    patch.__typename === 'SoupUpdated' &&
    patch.item.__typename === 'GraphqlSoupCall'
  );
}

/**
 * Keep unmaintained call lists current with the server's viewer-scoped patch.
 * This also covers engines that predate the call partition.
 */
export async function revalidateCallListsForSoupUpdates(
  patches: readonly SoupPatch[]
): Promise<void> {
  if (!patches.some(updatesCall)) return;
  await refreshActiveGraphqlSoupQueries({
    where: listCanIncludeCalls,
    unmaintainedOnly: true,
  });
}

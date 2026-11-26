import {
  type CacheAuthority,
  CacheAuthoritySchema,
} from './authority.generated';
import { getOrCreateCacheScope } from './scope';

// Owners issue fresh UUIDv7 generations. Nil is valid on the wire, but can never
// match an owner: omitted generations retain the deployed native legacy API.
export const UNKNOWN_CACHE_GENERATION = '00000000-0000-0000-0000-000000000000';
const MIRROR_KEY = 'graphql-cache:authority-hint:v1';

/** A startup hint only. Cross-window storage propagation is asynchronous. */
export function readGenerationMirror(
  identity = getOrCreateCacheScope()
): CacheAuthority | undefined {
  try {
    const parsed = CacheAuthoritySchema.safeParse(
      JSON.parse(localStorage.getItem(MIRROR_KEY) ?? 'null')
    );
    if (
      parsed.success &&
      parsed.data.identity === identity &&
      /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(parsed.data.generation)
    )
      return parsed.data;
  } catch {
    // Inaccessible storage costs recovery, never permission or startup time.
  }
}

/** Only validated owner observations update the next page's initial hint. */
export function rememberGeneration(authority: CacheAuthority): void {
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(authority));
  } catch {
    // The shared owner's exact comparison remains authoritative.
  }
}

export const startupAuthorityHint = readGenerationMirror();

/**
 * What the first owner observation of a page retires. `hint` is the mirror the
 * page read as it started.
 */
export function initialCacheRetirement(
  hint: CacheAuthority | undefined,
  owner: CacheAuthority
): 'session' | 'permission' | undefined {
  // A mirror lags the owner by one observation when its page unloads first.
  // Within one generation the owner only fills an empty account (the first
  // bind) or an empty policy (the first proof, when it is not a denial); every
  // other account or policy change issues a new generation. So an empty mirror
  // field at the owner's generation is the same session and access, not a
  // change. A denial never follows from a fill: a denied owner is compared
  // exactly.
  const filledSince = (mirrored: string | null | undefined) =>
    mirrored === null &&
    hint?.generation === owner.generation &&
    !owner.policy?.endsWith(':denied');
  if (
    hint &&
    (hint.identity !== owner.identity ||
      (hint.account !== owner.account && !filledSince(hint.account)))
  )
    return 'session';
  if (owner.policy !== null && !owner.ready) return 'permission';
  if (owner.policy?.endsWith(':denied')) {
    // A durable denial is found again on every start. A page that began under
    // that exact denial restored nothing but its identity, because persistence
    // stays closed while the mirror or the owner says denied, and fetched
    // everything it shows under the denial: it has nothing to retire. Any other
    // start may hold snapshots restored before another window recorded it.
    return hint?.generation === owner.generation && hint.policy === owner.policy
      ? undefined
      : 'permission';
  }
  if (!hint) {
    // Discovering a non-denied owner is not an access change. Keep mounted
    // readers (and their open menus). Only copied writes rejected by the owner
    // need a background reread; ordinary active queries remain current.
    // A mismatching signed-in account is fenced separately by the policy owner.
    return undefined;
  }
  if (hint.policy !== owner.policy && !filledSince(hint.policy))
    return 'permission';
  // The same account/team/access status may have gone denied then allowed
  // while starting. Its in-memory responses remain visible under the access
  // held now; only possible staleness remains. Copied writes still retain their
  // original UUID and must match the shared owner's exact current generation.
  return undefined;
}

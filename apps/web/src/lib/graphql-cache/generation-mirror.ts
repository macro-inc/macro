import { z } from 'zod/v3';
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

const PRUNED_KEY = 'graphql-cache:permission-pruned:v1';
const PrunedGenerationSchema = z.object({
  identity: z.string(),
  generation: z.string(),
});

/** The owner generation whose retirement last finished pruning this profile's
 * persisted queries. Unreadable storage only costs another prune. */
function readPrunedGeneration(
  identity = getOrCreateCacheScope()
): string | undefined {
  try {
    const parsed = PrunedGenerationSchema.safeParse(
      JSON.parse(localStorage.getItem(PRUNED_KEY) ?? 'null')
    );
    if (parsed.success && parsed.data.identity === identity)
      return parsed.data.generation;
  } catch {
    // The next start prunes again.
  }
}

export function rememberPrunedGeneration(
  generation: string,
  identity = getOrCreateCacheScope()
): void {
  try {
    localStorage.setItem(PRUNED_KEY, JSON.stringify({ identity, generation }));
  } catch {
    // The next start prunes again.
  }
}

/** Read with the hint, before this page restores anything from disk. */
export const startupPrunedGeneration = readPrunedGeneration();

/**
 * What the first owner observation of a page retires. `hint` and
 * `prunedGeneration` are what the page read as it started.
 */
export function initialCacheRetirement(
  hint: CacheAuthority | undefined,
  owner: CacheAuthority,
  prunedGeneration?: string
): 'session' | 'permission' | undefined {
  if (
    hint &&
    (hint.identity !== owner.identity || hint.account !== owner.account)
  )
    return 'session';
  if (owner.policy !== null && !owner.ready) return 'permission';
  if (owner.policy?.endsWith(':denied')) {
    // A durable denial is found again on every start. Its full prune need not
    // repeat when the page began under that exact denial with the prune already
    // complete: nothing it restored can predate the denial. Any other start may
    // hold snapshots restored before another window recorded or pruned it.
    const startedDenied =
      hint?.generation === owner.generation && hint.policy === owner.policy;
    return startedDenied && prunedGeneration === owner.generation
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
  if (hint.policy !== owner.policy) return 'permission';
  // The same account/team/access status may have gone denied then allowed
  // while starting. Its in-memory responses remain visible under the access
  // held now; only possible staleness remains. Copied writes still retain their
  // original UUID and must match the shared owner's exact current generation.
  return undefined;
}

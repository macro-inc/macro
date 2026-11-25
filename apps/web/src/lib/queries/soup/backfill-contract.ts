import type { SoupBackfillParams } from './backfill';

/** What a lane's saved progress is stored under: its checkpoint id and the
 * fields of its contract (`soupBackfillLaneContract`). */
export type SoupBackfillLane = Pick<
  SoupBackfillParams,
  | 'checkpointId'
  | 'operation'
  | 'input'
  | 'emailRecency'
  | 'refreshAll'
  | 'restartOnRun'
  | 'catchUpAfterInitialPass'
  | 'contractVersion'
>;

/**
 * Bump only when a change to the runner itself invalidates every lane's saved
 * progress (resume, watermark or completion semantics all lanes share). A
 * change to one lane's input or flags restarts that lane alone, through its
 * contract; a change to what one lane must refetch that its input and flags do
 * not show bumps that lane's `contractVersion`.
 */
export const BACKFILL_VERSION = 19;

const KEY_PREFIX = 'graphql-soup-backfill';

/** The tab coordinator builds from before contracts elect their leader on. */
const V19_COORDINATOR = `${KEY_PREFIX}:v19:coordinator`;

/**
 * Contracts the default lanes had in the last build before contracts, when
 * checkpoints were keyed by `BACKFILL_VERSION` 19 alone. A lane whose contract is still the one listed
 * here keeps using its v19 key, so builds from before contracts and after them
 * share its progress in both directions. Never edit an entry: a lane that
 * changes stops matching and moves to a key of its own.
 */
const V19_CONTRACTS: Readonly<Record<string, string>> = {
  'channel-directory-reconciled': '3b1kwa7wsg',
  'core-entities': 'kl0z6mxe5w',
  initiatives: 'gukroj7s83',
  'email-signal-filter-metadata': '2c6hk4hanqi',
  'email-noise-filter-metadata': 'xu27pg13gj',
  'shared-email-filter-metadata': '24qwui3uxb0',
  'email-signal-thread-pages': '1fqyeg189id',
  'email-noise-thread-pages': '1qkeyz8tp4j',
  'auxiliary-entities': 'oullg8aikh',
};

/** JSON with object keys sorted, so equal values always serialize the same. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item ?? null)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** cyrb53: a 53-bit string hash, in base 36. Not cryptographic; it only has to
 * tell a handful of lane contracts apart. */
function hashString(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The name of the operation a lane sends, such as `SoupMailBackfill`. */
function operationName(lane: SoupBackfillLane): string | null {
  for (const definition of lane.operation.definitions) {
    if (definition.kind === 'OperationDefinition') {
      return definition.name?.value ?? null;
    }
  }
  return null;
}

/**
 * What a lane's saved progress vouches for: the runner version, and the lane's
 * operation, input, recency windows, pass flags and own version. Page size and
 * spacing are not part of it: they change how a lane pages, not what a
 * finished pass has stored, and a resumed cursor keeps the page size it was
 * issued with. Neither is the operation's selection: a field added to it
 * reaches records as they are next fetched, as before contracts.
 */
export function soupBackfillLaneContract(lane: SoupBackfillLane): string {
  const { limit: _pageSize, ...input } = lane.input;
  return hashString(
    stableJson({
      runner: BACKFILL_VERSION,
      version: lane.contractVersion ?? 0,
      operation: operationName(lane),
      input,
      // No windows and an empty list both leave email unfiltered.
      emailRecency: lane.emailRecency?.length ? lane.emailRecency : null,
      refreshAll: lane.refreshAll === true,
      restartOnRun: lane.restartOnRun === true,
      catchUpAfterInitialPass: lane.catchUpAfterInitialPass === true,
    })
  );
}

/** Whether a lane still has the contract it had at version 19. */
function isV19Lane(lane: SoupBackfillLane): boolean {
  return V19_CONTRACTS[lane.checkpointId] === soupBackfillLaneContract(lane);
}

/**
 * The localStorage key of one user's checkpoint for a lane. Progress is stored
 * under the lane's contract, so a changed lane starts over while every other
 * lane resumes, and two builds that differ in a lane never resume each other's
 * cursor for it.
 */
export function soupBackfillCheckpointKey(
  userId: string,
  lane: SoupBackfillLane
): string {
  return isV19Lane(lane)
    ? `${KEY_PREFIX}:v${BACKFILL_VERSION}:${userId}:${lane.checkpointId}`
    : `${KEY_PREFIX}:c${soupBackfillLaneContract(lane)}:${userId}:${lane.checkpointId}`;
}

/**
 * The tab-leadership name for a set of lanes. Builds with the same lanes share
 * one leader; builds that differ in any lane each lead, as builds with
 * different backfill versions did before contracts. No build that locks
 * checkpoints leads the v19 coordinator, even with the v19 lanes: its leader
 * would hold that coordinator's leadership lock for as long as the tab leads,
 * and a newer build waits on that lock to run any v19 lane.
 */
export function soupBackfillCoordinatorKey(
  lanes: readonly SoupBackfillLane[]
): string {
  const contracts = lanes
    .map((lane) => [lane.checkpointId, soupBackfillLaneContract(lane)])
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `${KEY_PREFIX}:c${hashString(stableJson(contracts))}:coordinator`;
}

/**
 * The Web Lock a tab holds while it leads `coordinator`, named as
 * `tab-election` 4.6.2 names it. Builds from before checkpoint locks hold this
 * lock, and no other, while they run their lanes.
 */
export function soupBackfillLeadershipLock(coordinator: string): string {
  return `tab-${coordinator}`;
}

/**
 * The Web Locks a tab holds while it runs `lane`, taken in this order. A lane
 * under its v19 key also takes the v19 coordinator's leadership lock first: a
 * tab from before checkpoint locks holds it for as long as it leads, and runs
 * that lane unlocked. Later builds hold it only while they run such a lane.
 */
export function soupBackfillLaneLocks(
  userId: string,
  lane: SoupBackfillLane
): string[] {
  const checkpoint = soupBackfillCheckpointKey(userId, lane);
  return isV19Lane(lane)
    ? [soupBackfillLeadershipLock(V19_COORDINATOR), checkpoint]
    : [checkpoint];
}

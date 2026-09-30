/** Startup budgets are independent of the 10s cache-read deadline. Loading the
 * worker module graph and the WASM binary must not look like a wedged database.
 */
export const COORDINATOR_CONNECT_TIMEOUT_MS = 60_000;
export const ENGINE_ASSET_LOAD_TIMEOUT_MS = 5 * 60_000;
export const ENGINE_DATABASE_OPEN_TIMEOUT_MS = 20_000;
/** Delays between attempts to take a busy database owner lock. The engine
 * never queues for it: a handoff between owners of one build frees it within
 * milliseconds, and after these ~10s the engine gives up without touching
 * storage, so pages use the network until they reload.
 */
export const OWNER_LOCK_RETRY_DELAYS_MS: readonly number[] = [
  25, 50, 100, 200, 400, 800, 1_600, 3_200, 3_200,
];
/** When another build has live tabs, a busy lock is almost certainly theirs.
 * The coordinator asks that build to hand the database over and gives up
 * unless the holder agrees this soon; builds from before handover never do. */
export const TAKEOVER_REPLY_TIMEOUT_MS = 1_000;
/** Coordinator backstop for an engine that stops reporting while it waits. */
export const OWNER_LOCK_WAIT_TIMEOUT_MS =
  OWNER_LOCK_RETRY_DELAYS_MS.reduce((total, delay) => total + delay, 0) + 5_000;
/** Lets the coordinator's phase timeout/retry reach a page before its guard fires. */
export const STARTUP_RESPONSE_GRACE_MS = 5_000;
export const COORDINATOR_CONNECT_ATTEMPTS = 3;

/** Only the live coordinator can prove that every failed attempt stayed before
 * the open grant. A missing progress message is not proof of untouched storage.
 */
export class CacheBootstrapExhaustedError extends Error {}

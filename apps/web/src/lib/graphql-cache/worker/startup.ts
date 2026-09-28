/** Startup budgets are independent of the 10s cache-read deadline. Loading the
 * worker module graph and the WASM binary must not look like a wedged database.
 */
export const COORDINATOR_CONNECT_TIMEOUT_MS = 60_000;
export const ENGINE_ASSET_LOAD_TIMEOUT_MS = 5 * 60_000;
export const ENGINE_DATABASE_OPEN_TIMEOUT_MS = 20_000;
/** Lets the coordinator's phase timeout/retry reach a page before its guard fires. */
export const STARTUP_RESPONSE_GRACE_MS = 5_000;
export const COORDINATOR_CONNECT_ATTEMPTS = 3;

/** Only the live coordinator can prove that every failed attempt stayed before
 * the open grant. A missing progress message is not proof of untouched storage.
 */
export class CacheBootstrapExhaustedError extends Error {}

/**
 * Nonce storage for optimistic update deduplication.
 *
 * ## Problem
 * When a user performs an action (e.g., sends a message), we:
 * 1. Apply the change optimistically to the UI
 * 2. Send the request to the server
 * 3. Receive a WebSocket event when the server broadcasts the change
 *
 * Without deduplication, step 3 would re-apply the change, causing duplicates.
 *
 * ## Solution: Nonce-based deduplication
 * 1. In `onMutate`: Generate a unique nonce, register it, apply optimistic update
 * 2. In `mutationFn`: Send the nonce with the request to the server
 * 3. Server echoes the nonce back in the WebSocket broadcast
 * 4. In WebSocket handler: Check if nonce is registered (our own action) → skip update
 *    If not registered (external action from another user/tab) → apply update
 *
 * ## Lifecycle
 * ```
 * prepare() → registers nonce, stores for later retrieval
 *     ↓
 * use() → retrieves the nonce for the API request
 *     ↓
 * [WebSocket arrives] → consumeNonce() returns true, skip cache update
 *     ↓
 * cleanup() → removes from pending map (in onSettled)
 * ```
 *
 * Nonces auto-expire after TTL to handle cases where WebSocket events are lost.
 */

const NONCE_TTL_MS = 60_000; // 60 seconds - allows for slow networks

type NonceEntry = {
  nonce: string;
  expiresAt: number;
  timerId: ReturnType<typeof setTimeout>;
};

const noncesByKey = new Map<string, Map<string, NonceEntry>>();

function isNonceValid(
  nonceMap: Map<string, NonceEntry>,
  nonce: string
): boolean {
  const entry = nonceMap.get(nonce);
  if (!entry) return false;

  if (Date.now() > entry.expiresAt) {
    clearTimeout(entry.timerId);
    nonceMap.delete(nonce);
    cleanupEmptyMap(nonceMap);
    return false;
  }

  return true;
}

function cleanupEmptyMap(nonceMap: Map<string, NonceEntry>): void {
  if (nonceMap.size === 0) {
    for (const [key, map] of noncesByKey.entries()) {
      if (map === nonceMap) {
        noncesByKey.delete(key);
        break;
      }
    }
  }
}

/**
 * Register a nonce for a given event type.
 * The nonce will auto-expire after TTL to prevent memory leaks.
 * Must be called in onMutate (synchronously before request) to avoid race conditions.
 */
export function registerNonce(key: string, nonce: string): void {
  let nonceMap = noncesByKey.get(key);
  if (!nonceMap) {
    nonceMap = new Map();
    noncesByKey.set(key, nonceMap);
  }

  const existing = nonceMap.get(nonce);
  if (existing) {
    clearTimeout(existing.timerId);
  }

  const currentNonceMap = nonceMap;

  const timerId = setTimeout(() => {
    if (noncesByKey.get(key) === currentNonceMap) {
      currentNonceMap.delete(nonce);
      cleanupEmptyMap(currentNonceMap);
    }
  }, NONCE_TTL_MS);

  nonceMap.set(nonce, {
    nonce,
    expiresAt: Date.now() + NONCE_TTL_MS,
    timerId,
  });
}

/**
 * Check if a nonce exists and consume it (remove from storage).
 * Returns true if the nonce was found and consumed.
 */
export function consumeNonce(
  key: string,
  nonce: string | undefined | null
): boolean {
  if (!nonce) return false;

  const nonceMap = noncesByKey.get(key);
  if (!nonceMap) return false;

  if (!isNonceValid(nonceMap, nonce)) return false;

  const entry = nonceMap.get(nonce);
  if (entry) {
    clearTimeout(entry.timerId);
    nonceMap.delete(nonce);
    cleanupEmptyMap(nonceMap);
  }

  return true;
}

/**
 * Creates a nonce coordinator for mutations.
 * Handles the pattern of generating nonce in onMutate and retrieving in mutationFn.
 *
 * @example
 * const nonce = createMutationNonce('my_key', (v) => `${v.id}`);
 *
 * // In mutation:
 * onMutate: (vars) => { nonce.prepare(vars); ... },
 * mutationFn: (vars) => { nonce: nonce.use(vars), ... },
 * onSettled: (_, __, vars) => { nonce.cleanup(vars); ... }
 */
export function createMutationNonce<TVars>(
  nonceKey: string,
  makeKey: (vars: TVars) => string
) {
  const pending = new Map<string, string>();

  return {
    /** Generate nonce, register for deduplication, store for later retrieval. Call in onMutate. */
    prepare: (vars: TVars): string => {
      const key = makeKey(vars);
      const nonce = crypto.randomUUID();
      pending.set(key, nonce);
      registerNonce(nonceKey, nonce);
      return nonce;
    },

    /**
     * Retrieve the prepared nonce for this mutation. Call in mutationFn.
     * @throws Error if prepare() was not called first (indicates a bug in mutation setup)
     */
    use: (vars: TVars): string => {
      const key = makeKey(vars);
      const nonce = pending.get(key);
      if (!nonce) {
        throw new Error(
          `Nonce not found for key "${key}". Ensure prepare() is called in onMutate before use() is called in mutationFn.`
        );
      }
      return nonce;
    },

    /** Remove stored nonce. Call in onSettled. */
    cleanup: (vars: TVars): void => {
      const key = makeKey(vars);
      pending.delete(key);
    },
  };
}

/**
 * Nonce storage for optimistic update deduplication.
 *
 * When a mutation is performed optimistically, we register the nonce.
 * When a WebSocket event arrives with that nonce, we consume it and
 * skip re-applying the update (since it was already applied optimistically).
 */

const NONCE_TTL_MS = 60_000; // 60 seconds - allows for slow networks

type NonceEntry = {
  nonce: string;
  expiresAt: number;
  timerId: ReturnType<typeof setTimeout>;
};

// Map<eventType, Map<nonce, NonceEntry>>
const noncesByKey = new Map<string, Map<string, NonceEntry>>();

/**
 * Check if a nonce entry is valid (not expired).
 * Cleans up expired entries as a side effect.
 */
function isNonceValid(
  nonceMap: Map<string, NonceEntry>,
  nonce: string
): boolean {
  const entry = nonceMap.get(nonce);
  if (!entry) return false;

  if (Date.now() > entry.expiresAt) {
    clearTimeout(entry.timerId);
    nonceMap.delete(nonce);
    cleanupEmptyMap(nonceMap, nonce);
    return false;
  }

  return true;
}

/**
 * Remove empty nonceMaps from noncesByKey to prevent memory leaks.
 */
function cleanupEmptyMap(
  nonceMap: Map<string, NonceEntry>,
  _nonce: string
): void {
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

  // Clear existing timer if re-registering same nonce
  const existing = nonceMap.get(nonce);
  if (existing) {
    clearTimeout(existing.timerId);
  }

  // Capture reference to current nonceMap for closure safety
  const currentNonceMap = nonceMap;

  const timerId = setTimeout(() => {
    // Verify the map in noncesByKey is still the same instance
    // to prevent stale closure issues
    if (noncesByKey.get(key) === currentNonceMap) {
      currentNonceMap.delete(nonce);
      cleanupEmptyMap(currentNonceMap, nonce);
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
    cleanupEmptyMap(nonceMap, nonce);
  }

  return true;
}

/**
 * Check if a nonce exists without consuming it.
 */
export function hasNonce(
  key: string,
  nonce: string | undefined | null
): boolean {
  if (!nonce) return false;

  const nonceMap = noncesByKey.get(key);
  if (!nonceMap) return false;

  return isNonceValid(nonceMap, nonce);
}

// Event type constants for consistency
export const NonceKeys = {
  MESSAGE: 'comms_message',
  REACTION: 'comms_reaction',
  TYPING: 'comms_typing',
  ATTACHMENT: 'comms_attachment',
} as const;

/**
 * Creates a nonce coordinator for mutations.
 * Handles the pattern of generating nonce in onMutate and retrieving in mutationFn.
 *
 * @example
 * const nonce = createMutationNonce(NonceKeys.MESSAGE, (v) => `${v.channelId}:${v.messageId}`);
 *
 * // In mutation:
 * onMutate: (vars) => { nonce.prepare(vars); ... },
 * mutationFn: (vars) => { const n = nonce.get(vars); ... },
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

    /** Use the prepared nonce for this mutation. Call in mutationFn. */
    use: (vars: TVars): string => {
      const key = makeKey(vars);
      return pending.get(key) ?? crypto.randomUUID();
    },

    /** Remove stored nonce. Call in onSettled. */
    cleanup: (vars: TVars): void => {
      const key = makeKey(vars);
      pending.delete(key);
    },
  };
}

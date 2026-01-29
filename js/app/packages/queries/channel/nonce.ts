/**
 * Nonce storage for optimistic update deduplication.
 *
 * When a mutation is performed optimistically, we register the nonce.
 * When a WebSocket event arrives with that nonce, we consume it and
 * skip re-applying the update (since it was already applied optimistically).
 */

const NONCE_TTL_MS = 30_000; // 30 seconds

type NonceEntry = {
  nonce: string;
  expiresAt: number;
};

// Map<eventType, Map<nonce, NonceEntry>>
const noncesByKey = new Map<string, Map<string, NonceEntry>>();

/**
 * Register a nonce for a given event type.
 * The nonce will auto-expire after TTL to prevent memory leaks.
 */
export function registerNonce(key: string, nonce: string): void {
  let nonceMap = noncesByKey.get(key);
  if (!nonceMap) {
    nonceMap = new Map();
    noncesByKey.set(key, nonceMap);
  }

  nonceMap.set(nonce, {
    nonce,
    expiresAt: Date.now() + NONCE_TTL_MS,
  });

  // Schedule cleanup
  setTimeout(() => {
    nonceMap?.delete(nonce);
  }, NONCE_TTL_MS);
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

  const entry = nonceMap.get(nonce);
  if (!entry) return false;

  if (Date.now() > entry.expiresAt) {
    nonceMap.delete(nonce);
    return false;
  }

  nonceMap.delete(nonce);
  return true;
}

/**
 * Check if a nonce exists without consuming it.
 */
export function hasNonce(key: string, nonce: string | undefined | null): boolean {
  if (!nonce) return false;

  const nonceMap = noncesByKey.get(key);
  if (!nonceMap) return false;

  const entry = nonceMap.get(nonce);
  if (!entry) return false;

  if (Date.now() > entry.expiresAt) {
    nonceMap.delete(nonce);
    return false;
  }

  return true;
}

// Event type constants for consistency
export const NonceKeys = {
  MESSAGE: 'comms_message',
  REACTION: 'comms_reaction',
  TYPING: 'comms_typing',
  ATTACHMENT: 'comms_attachment',
} as const;

/**
 * Sessions this tab viewed last, kept open after their surface goes away.
 *
 * Switching between agent sessions unmounts one block and mounts another, and
 * the last release closes the session: switching back paid for a cache read,
 * the session row and the whole log again, each a network round trip. Holding
 * one extra acquisition on the few sessions viewed last keeps their fold and
 * their live rows, so a switch back renders what the machine already holds.
 *
 * Only sessions that loaded are held: a failed or refused load must stay
 * retryable from scratch, and an abandoned one has nothing worth keeping.
 */

import { AgentSession } from './AgentSession';

/** How many sessions stay open past their last surface. */
const RETAINED_SESSIONS = 8;

/** Held acquisitions, least recently viewed first. */
const retained = new Map<string, AgentSession>();

/** `id` was just viewed: hold it, and let go of the oldest past the limit. */
export function retainRecentlyViewed(id: string): void {
  const held = retained.get(id);
  retained.delete(id);
  retained.set(id, held ?? AgentSession.acquire(id, 'hold'));
  for (const [oldest, session] of retained) {
    if (retained.size <= RETAINED_SESSIONS) break;
    retained.delete(oldest);
    session.release();
  }
}

/** Stop holding `id`, for a session the viewer may no longer see. */
export function forgetRecentlyViewed(id: string): void {
  const held = retained.get(id);
  if (!held) return;
  retained.delete(id);
  held.release();
}

/** Whether `id` is held open from an earlier view. */
export function isRecentlyViewed(id: string): boolean {
  return retained.has(id);
}

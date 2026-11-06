/**
 * Sessions opened ahead of a click, so the switch finds them loaded.
 *
 * Opening a session waits on two network round trips, the session row and its
 * log, before anything shows. A list row knows which session is about to open
 * before the press does: the pointer rests on it, or it takes keyboard focus.
 * Opening the session then gives the fetch that head start; the view that
 * mounts on the press acquires the same instance, already loaded or with its
 * fetch in flight.
 *
 * Touch gets no prefetch. It has no hover, and the press that would be the
 * earliest sign also starts every scroll of the list, which would open
 * whatever row the finger landed on.
 *
 * A prefetch nobody opens costs the reads and a live log follow, so it is
 * bounded: a few sessions at a time, each let go once the pointer has been
 * elsewhere for a while.
 */

import { debounce } from '@core/util/debounce';
import { AgentSession } from './AgentSession';

/** How long a prefetched session nobody opened stays open. */
const PREFETCH_HOLD_MS = 30_000;

/** How many prefetched sessions stay open at once. */
const PREFETCHED_SESSIONS = 4;

/**
 * How long the pointer rests on a row before it counts as intent. Long enough
 * that sweeping across a list fetches nothing, well inside the time between
 * settling on a row and pressing it.
 */
const HOVER_INTENT_MS = 100;

type Prefetched = {
  session: AgentSession;
  /** Lets go of the session; asking again restarts the wait. */
  expire: ReturnType<typeof debounce<() => void>>;
};

/** Held prefetches, least recently asked for first. */
const prefetched = new Map<string, Prefetched>();

/** Start loading `id`, unless it is open already. */
export function prefetchAgentSession(id: string): void {
  const held = prefetched.get(id);
  if (held) {
    prefetched.delete(id);
    prefetched.set(id, held);
    held.expire();
    return;
  }
  // Open for a view, a hold, or an earlier prefetch: nothing to start.
  if (AgentSession.get(id)) return;
  const entry: Prefetched = {
    session: AgentSession.acquire(id, 'prefetch'),
    expire: debounce(() => forgetPrefetchedAgentSession(id), PREFETCH_HOLD_MS),
  };
  prefetched.set(id, entry);
  entry.expire();
  for (const [oldest] of prefetched) {
    if (prefetched.size <= PREFETCHED_SESSIONS) break;
    forgetPrefetchedAgentSession(oldest);
  }
}

/** Stop holding `id`, for a session the viewer may no longer see. */
export function forgetPrefetchedAgentSession(id: string): void {
  const held = prefetched.get(id);
  if (!held) return;
  prefetched.delete(id);
  held.expire.clear();
  held.session.release();
}

/**
 * Handlers for a row that opens `id`: a resting pointer or keyboard focus
 * prefetches it. The hover a touch synthesizes on its tap is not a rest.
 */
export function prefetchOnIntent(id: () => string) {
  const hovered = debounce(() => prefetchAgentSession(id()), HOVER_INTENT_MS);
  return {
    onPointerEnter: (event: PointerEvent) => {
      if (event.pointerType !== 'touch') hovered();
    },
    onPointerLeave: () => hovered.clear(),
    onFocus: () => prefetchAgentSession(id()),
  };
}

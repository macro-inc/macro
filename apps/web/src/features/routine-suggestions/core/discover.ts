import { z } from 'zod';

/** How many seen picks are kept; more than any one generation offers. */
const SEEN_LIMIT = 200;

const seenSchema = z.array(z.string()).max(SEEN_LIMIT);

/**
 * Whether Discover has AI picks the person hasn't seen there yet: false
 * until it is known what they saw, so the dot never flashes on.
 */
export function hasUnseenPicks(
  picks: readonly string[],
  seen: readonly string[] | undefined
): boolean {
  if (!seen) return false;
  return picks.some((id) => !seen.includes(id));
}

/** The seen picks to keep once Discover showed `picks`. */
export function seenAfterShowing(picks: readonly string[]): string[] {
  return picks.slice(0, SEEN_LIMIT);
}

/** Seen picks as stored; anything unreadable counts as none seen. */
export function parseSeenPicks(stored: string | null): string[] {
  if (stored === null) return [];
  try {
    const parsed = seenSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

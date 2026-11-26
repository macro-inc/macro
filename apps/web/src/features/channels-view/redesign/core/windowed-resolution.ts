import type { DirectoryChannel } from '@queries/channel/directory-core';
import type { SidebarLens, SidebarSection } from './sidebar-model';
import { isSupportSection } from './support-triage';

/**
 * Explicit window contract for sidebar channel resolution.
 *
 * Callers must pass a bounded window; collecting every channel ID across all
 * sections (collapsed or offscreen) is disallowed by construction so large
 * workspaces (6,500+ channels) never dispatch unbounded `useCachedChannelsByIds`
 * batches.
 */
export type ChannelResolutionWindow = {
  /** Maximum missing IDs resolved per expanded Browse section before "Show more". */
  readonly maxPerSection: number;
  /** Maximum missing pinned favorite IDs resolved when Pinned is open. */
  readonly maxFavorites: number;
  /** Maximum missing support-section IDs resolved when the Support lens is open. */
  readonly maxSupportWindow: number;
  /** Hard ceiling on total missing IDs passed to `useCachedChannelsByIds`. */
  readonly maxTotal: number;
};

export const DEFAULT_SECTION_WINDOW_SIZE = 16;
export const SECTION_WINDOW_PAGE_STEP = 25;
export const DEFAULT_MAX_FAVORITES_WINDOW = 30;
export const DEFAULT_SUPPORT_LENS_WINDOW = 50;
export const DEFAULT_MAX_TOTAL_RESOLVED_IDS = 150;

export const DEFAULT_CHANNEL_RESOLUTION_WINDOW: ChannelResolutionWindow = {
  maxPerSection: DEFAULT_SECTION_WINDOW_SIZE,
  maxFavorites: DEFAULT_MAX_FAVORITES_WINDOW,
  maxSupportWindow: DEFAULT_SUPPORT_LENS_WINDOW,
  maxTotal: DEFAULT_MAX_TOTAL_RESOLVED_IDS,
};

function clampPositive(value: number, ceiling: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), ceiling);
}

/**
 * Collect ONLY the missing channel IDs needed for what is currently expanded
 * and windowed on screen.
 *
 * - Collapsed and hidden sections contribute 0 IDs (their headers use unread
 *   counts and server member counts instead of full channel rows).
 * - Focus and Threads lenses contribute 0 section IDs (Focus reads strictly
 *   from the bounded unread + recent Soup queries).
 * - Expanded Browse sections prioritize unread members first, then fill up to
 *   the section's current window limit, under a global `window.maxTotal` cap.
 * - Support lens resolves only the active Support window when opened.
 */
export function collectWindowedReferencedChannelIds(options: {
  sections: readonly Pick<
    SidebarSection,
    'id' | 'name' | 'scope' | 'ruleContains' | 'channelIds'
  >[];
  favoriteChannelIds: readonly string[];
  loadedIds: ReadonlySet<string>;
  unreadIds: ReadonlySet<string>;
  activeLens: SidebarLens;
  favoritesOpen: boolean;
  openSectionIds: ReadonlySet<string>;
  hiddenTeamSectionIds: ReadonlySet<string>;
  sectionWindowLimits?: ReadonlyMap<string, number>;
  supportWindowLimit?: number;
  window: ChannelResolutionWindow;
}): string[] {
  const maxTotal = clampPositive(
    options.window.maxTotal,
    DEFAULT_MAX_TOTAL_RESOLVED_IDS * 4
  );
  if (maxTotal === 0) return [];

  const collected: string[] = [];
  const seen = new Set<string>();

  const pushMissing = (id: string): boolean => {
    if (collected.length >= maxTotal) return false;
    if (options.loadedIds.has(id) || seen.has(id)) return true;
    seen.add(id);
    collected.push(id);
    return collected.length < maxTotal;
  };

  // 1. Pinned favorites (only on Browse when Pinned is open).
  if (options.activeLens === 'browse' && options.favoritesOpen) {
    const favBudget = clampPositive(options.window.maxFavorites, maxTotal);
    let favTaken = 0;
    for (const id of options.favoriteChannelIds) {
      if (favTaken >= favBudget || collected.length >= maxTotal) break;
      if (options.loadedIds.has(id) || seen.has(id)) {
        favTaken += 1;
        continue;
      }
      seen.add(id);
      collected.push(id);
      favTaken += 1;
    }
  }

  // 2. Focus and Threads never expand arbitrary section IDs via by-ID fetch.
  if (options.activeLens === 'focus' || options.activeLens === 'threads') {
    return collected;
  }

  // 3. Support lens: resolve only the visible window of support sections.
  if (options.activeLens === 'support') {
    const requested =
      options.supportWindowLimit ?? options.window.maxSupportWindow;
    const supportBudget = clampPositive(
      Math.min(requested, options.window.maxSupportWindow),
      maxTotal
    );
    const supportIds: string[] = [];
    const supportSeen = new Set<string>();
    for (const section of options.sections) {
      if (
        section.scope === 'team' &&
        options.hiddenTeamSectionIds.has(section.id)
      ) {
        continue;
      }
      if (!isSupportSection(section)) continue;
      for (const id of section.channelIds) {
        if (supportSeen.has(id)) continue;
        supportSeen.add(id);
        supportIds.push(id);
      }
    }
    let taken = 0;
    // Unread support IDs first so waiting customers always fit inside the window.
    for (const id of supportIds) {
      if (taken >= supportBudget || collected.length >= maxTotal) break;
      if (!options.unreadIds.has(id)) continue;
      taken += 1;
      if (!pushMissing(id)) return collected;
    }
    for (const id of supportIds) {
      if (taken >= supportBudget || collected.length >= maxTotal) break;
      if (options.unreadIds.has(id)) continue;
      taken += 1;
      if (!pushMissing(id)) return collected;
    }
    return collected;
  }

  // 4. Browse lens: resolve ONLY expanded, visible sections up to each section's window.
  for (const section of options.sections) {
    if (collected.length >= maxTotal) break;
    if (!options.openSectionIds.has(section.id)) continue;
    if (
      section.scope === 'team' &&
      options.hiddenTeamSectionIds.has(section.id)
    ) {
      continue;
    }

    const sectionRequested =
      options.sectionWindowLimits?.get(section.id) ??
      options.window.maxPerSection;
    const sectionBudget = clampPositive(sectionRequested, maxTotal);
    if (sectionBudget === 0) continue;

    let sectionTaken = 0;
    // Count unread members first (both loaded and missing) so unread rows stay pinned at top.
    for (const id of section.channelIds) {
      if (sectionTaken >= sectionBudget || collected.length >= maxTotal) break;
      if (!options.unreadIds.has(id)) continue;
      sectionTaken += 1;
      if (!pushMissing(id)) return collected;
    }
    for (const id of section.channelIds) {
      if (sectionTaken >= sectionBudget || collected.length >= maxTotal) break;
      if (options.unreadIds.has(id)) continue;
      sectionTaken += 1;
      if (!pushMissing(id)) return collected;
    }
  }

  return collected;
}

/**
 * Compute unread, mention, and total member counts for a section purely from
 * its ID list and bounded activity sets — zero full channel rows required.
 */
export function computeSectionCountsFromIds(
  channelIds: readonly string[],
  unreadIds: ReadonlySet<string>,
  mentionCounts: ReadonlyMap<string, number>,
  excludedIds?: ReadonlySet<string>
): { unreadCount: number; mentionCount: number; totalCount: number } {
  let unreadCount = 0;
  let mentionCount = 0;
  let totalCount = 0;
  for (const id of channelIds) {
    if (excludedIds?.has(id)) continue;
    totalCount += 1;
    if (unreadIds.has(id)) unreadCount += 1;
    mentionCount += mentionCounts.get(id) ?? 0;
  }
  return { unreadCount, mentionCount, totalCount };
}

/**
 * Fast, allocation-light top-K search over plain `DirectoryChannel` records
 * used lazily ONLY while Quick Switch is open. Avoids converting thousands of
 * directory rows into `SidebarChannel` or `ChannelEntity` objects up front.
 */
export function searchDirectoryTopK(
  records: readonly DirectoryChannel[],
  query: string,
  limit: number,
  excludeIds?: ReadonlySet<string>
): DirectoryChannel[] {
  const cap = clampPositive(limit, 100);
  if (cap === 0 || records.length === 0) return [];
  const normalized = query.trim().toLowerCase();

  type Scored = { record: DirectoryChannel; score: number };
  const matches: Scored[] = [];

  for (const record of records) {
    if (excludeIds?.has(record.id)) continue;
    const rawName = (record.agentDm?.name ?? record.name ?? '').trim();
    if (!normalized) {
      matches.push({ record, score: record.frecencyScore ?? 0 });
      continue;
    }
    const lower = rawName.toLowerCase();
    let score = 0;
    if (lower === normalized) score = 1000;
    else if (lower.startsWith(normalized)) score = 700;
    else if (lower.includes(normalized)) score = 400;
    else {
      // Lightweight subsequence check for abbreviated jumps like "msx" or "engf"
      let qi = 0;
      for (let i = 0; i < lower.length && qi < normalized.length; i += 1) {
        if (lower[i] === normalized[qi]) qi += 1;
      }
      if (qi === normalized.length) score = 150;
    }
    if (score > 0) {
      matches.push({ record, score: score + (record.frecencyScore ?? 0) });
    }
  }

  matches.sort(
    (left, right) =>
      right.score - left.score ||
      right.record.updatedAt.localeCompare(left.record.updatedAt)
  );
  return matches.slice(0, cap).map((entry) => entry.record);
}

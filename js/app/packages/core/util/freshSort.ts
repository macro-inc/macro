/**
 * Wrap the fuzzy library in some addition utils for ranking by fuzzy match score
 * alongside freshness.
 */
import type { FilterResult } from 'fuzzy';
import fuzzy from 'fuzzy';
import { fuzzyScoreCommaSpaceSeparated } from './fuzzy';

export interface FreshSortConfig {
  /** Weight for fuzzy match (0-1). Higher values prioritize search relevance. Default: 0.7 */
  fuzzyWeight?: number;
  /** Weight for time recency (0-1). Higher values prioritize recent items. Default: 0.3 */
  timeWeight?: number;
  /** Weight for brevity (0-1). Higher values prioritize shorter items. Default: 0.0 */
  brevityWeight?: number;
  /** Time decay factor. Higher values make older items decay faster. Default: 0.5 */
  timeDecayFactor?: number;
  /** Maximum age in milliseconds to consider for scoring. Items older than this get minimum time score. Default: 30 days */
  maxAgeMs?: number;
  /** Minimum fuzzy score threshold (0-1). Items below this are heavily penalized. Default: 0.1 */
  minFuzzyThreshold?: number;
  /** Use viewedAt instead of updatedAt for time scoring. Default: false */
  useViewedAt?: boolean;
  /** Boost multiplier for channel items when query is present. Default: 1.0 (no boost) */
  channelBoost?: number;
  /** Enable comma-separated matching for channel names. When enabled, query "a,b" matches channel name "a,c,b". Default: false */
  commaSeparatedChannelMatch?: boolean;
}

export interface TimestampedItem {
  updatedAt?: number | string;
  updated_at?: number | string;
  viewedAt?: number | string;
  viewed_at?: number | string;
  lastInteraction?: number | string;
  last_interaction?: number | string;
  type?: string;
  [key: string]: any;
}

export interface FreshSortResult<T> {
  item: T;
  fuzzyScore: number;
  timeScore: number;
  brevityScore: number;
  combinedScore: number;
  fuzzyResult?: FilterResult<T>;
}

const DEFAULT_CONFIG: Required<FreshSortConfig> = {
  fuzzyWeight: 0.7,
  timeWeight: 0.3,
  brevityWeight: 0.0,
  timeDecayFactor: 0.5,
  maxAgeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  minFuzzyThreshold: 0.1,
  useViewedAt: false,
  channelBoost: 1.0,
  commaSeparatedChannelMatch: false,
};

function extractTimestamp(
  item: TimestampedItem,
  useViewedAt: boolean = false
): number {
  let timestamp: number | string | undefined;

  if (useViewedAt) {
    timestamp =
      item.viewedAt ??
      item.viewed_at ??
      item.updatedAt ??
      item.updated_at ??
      item.lastInteraction ??
      item.last_interaction;
  } else {
    timestamp =
      item.updatedAt ??
      item.updated_at ??
      item.lastInteraction ??
      item.last_interaction;
  }

  if (timestamp === undefined || timestamp === null) return 0;

  if (typeof timestamp === 'number') {
    return timestamp > 1e10 ? Math.floor(timestamp / 1000) : timestamp;
  }

  if (typeof timestamp === 'string') {
    const isoDate = new Date(timestamp);
    if (!isNaN(isoDate.getTime())) {
      return Math.floor(isoDate.getTime() / 1000);
    }

    const parsed = parseInt(timestamp, 10);
    if (!isNaN(parsed)) {
      return parsed > 1e10 ? Math.floor(parsed / 1000) : parsed;
    }
  }

  return 0;
}

function isChannelItem(item: TimestampedItem): boolean {
  return item.type === 'channel';
}

function calculateTimeScore(
  timestamp: number,
  config: Required<FreshSortConfig>
): number {
  const now = Date.now();
  const itemTime = timestamp * 1000;
  const age = Math.max(0, now - itemTime);
  if (age >= config.maxAgeMs) {
    return 0;
  }

  // exponential decay: e^(-decay * normalizedAge)
  const normalizedAge = age / config.maxAgeMs;
  return Math.exp(-config.timeDecayFactor * normalizedAge);
}

export function normalizeFuzzyScore(
  fuzzyScore: number,
  maxPossibleScore: number
): number {
  if (!Number.isFinite(fuzzyScore)) {
    throw new Error(`fuzzyScore must be a finite number, got: ${fuzzyScore}`);
  }
  if (!Number.isFinite(maxPossibleScore) || maxPossibleScore <= 0) {
    throw new Error(
      `maxPossibleScore must be a finite positive number, got: ${maxPossibleScore}`
    );
  }

  return Math.max(0, Math.min(1, fuzzyScore / maxPossibleScore));
}

function calculateBrevityScore(text: string): number {
  if (!text || text.length === 0) return 0;
  const maxLength = 100;
  const normalizedLength = Math.min(text.length, maxLength) / maxLength;
  return Math.exp(-2 * normalizedLength);
}

export function freshSort<T extends TimestampedItem>(
  filterResults: FilterResult<T>[],
  config: FreshSortConfig = {}
): FreshSortResult<T>[] {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const totalWeight =
    finalConfig.fuzzyWeight +
    finalConfig.timeWeight +
    finalConfig.brevityWeight;
  const normalizedFuzzyWeight = finalConfig.fuzzyWeight / totalWeight;
  const normalizedTimeWeight = finalConfig.timeWeight / totalWeight;
  const normalizedBrevityWeight = finalConfig.brevityWeight / totalWeight;

  const filterNoInfResults = filterResults.filter((r) => r.score !== Infinity);
  const maxFuzzyScore =
    filterNoInfResults.length > 0
      ? Math.max(...filterNoInfResults.map((r) => r.score))
      : 1;

  const scoredResults: FreshSortResult<T>[] = filterResults.map((result) => {
    const rawScore = result.score === Infinity ? maxFuzzyScore : result.score;
    const fuzzyScore =
      maxFuzzyScore === 0 ? 0 : normalizeFuzzyScore(rawScore, maxFuzzyScore);
    const timeScore = calculateTimeScore(
      extractTimestamp(result.original, finalConfig.useViewedAt),
      finalConfig
    );

    const textForBrevity = result.string || '';
    const brevityScore = calculateBrevityScore(textForBrevity);

    // Apply fuzzy threshold penalty
    const fuzzyPenalty = fuzzyScore < finalConfig.minFuzzyThreshold ? 0.1 : 1;

    const channelMultiplier = isChannelItem(result.original)
      ? finalConfig.channelBoost
      : 1.0;

    const combinedScore =
      (normalizedFuzzyWeight * fuzzyScore +
        normalizedTimeWeight * timeScore +
        normalizedBrevityWeight * brevityScore) *
      fuzzyPenalty *
      channelMultiplier;

    return {
      item: result.original,
      fuzzyScore,
      timeScore,
      brevityScore,
      combinedScore,
      fuzzyResult: result,
    };
  });

  scoredResults.sort((a, b) => b.combinedScore - a.combinedScore);
  return scoredResults;
}

export function createFreshSearch<T extends TimestampedItem>(
  config: FreshSortConfig = {},
  extractor: (item: T) => string
) {
  return (items: T[], query: string): FreshSortResult<T>[] => {
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    const hasComma = query.includes(',');
    const hasSpace = query.includes(' ');
    const useMultiTermChannelMatch =
      finalConfig.commaSeparatedChannelMatch && (hasComma || hasSpace);

    if (useMultiTermChannelMatch) {
      // For comma or space-separated queries, handle channel items specially
      const channelResults: FilterResult<T>[] = [];
      const nonChannelItems: T[] = [];

      for (const item of items) {
        if (isChannelItem(item)) {
          const name = extractor(item);
          const score = fuzzyScoreCommaSpaceSeparated(query, name);
          if (score >= 0) {
            channelResults.push({
              original: item,
              string: name,
              score: score * 100, // Scale to match fuzzy library scoring
              index: 0,
            });
          }
        } else {
          nonChannelItems.push(item);
        }
      }

      // Get fuzzy results for non-channel items using regular matching
      const nonChannelResults = fuzzy.filter(query, nonChannelItems, {
        extract: extractor,
      });

      // Combine results
      const allResults = [...channelResults, ...nonChannelResults];
      return freshSort(allResults, config);
    }

    const fuzzyResults = fuzzy.filter(query, items, {
      extract: extractor,
    });
    return freshSort(fuzzyResults, config);
  };
}

/**
 * Wrap the fuzzy library in some addition utils for ranking by fuzzy match score
 * alongside freshness.
 */
import type { Accessor } from 'solid-js';
import type { FilterResult } from 'fuzzy';
import fuzzy from 'fuzzy';
import { differenceInMilliseconds } from 'date-fns';
import type { DateValue } from './date';
import { fuzzyScoreCommaSpaceSeparated } from './fuzzy';
import {
  type ParsedDuration,
  parsedDurationToMilliseconds,
} from './dateSearch/dateParser';

type BoostFn<T> = (item: T) => number;

type NameFn<T> = (item: T) => string;

type TimestampFn<T> = (item: T) => TimestampedItem;

type BooleanFn<T> = (item: T) => boolean;

type EmailFn<T> = (item: T) => string | undefined;

export interface FreshSortConfig<T> {
  /** Weight for fuzzy match (0-1). Higher values prioritize search relevance. Default: 0.7 */
  fuzzyWeight?: number;
  /** Weight for time recency (0-1). Higher values prioritize recent items. Default: 0.3 */
  timeWeight?: number;
  /** Weight for brevity (0-1). Higher values prioritize shorter items. Default: 0.0 */
  brevityWeight?: number;
  /** Time decay factor. Higher values make older items decay faster. Default: 0.5 */
  timeDecayFactor?: number;
  /** Maximum age to consider for scoring. Items older than this get minimum time score. Default: 30 days */
  maxAge?: ParsedDuration;
  /** Minimum fuzzy score threshold (0-1). Items below this are heavily penalized. Default: 0.1 */
  minFuzzyThreshold?: number;
  /** Use viewedAt instead of updatedAt for time scoring. Default: false */
  useViewedAt?: boolean;
  /** Boost multiplier for channel items when query is present. Default: 1.0 (no boost) */
  channelBoost?: number;
  /** Boost multiplier for DM items. Default: 1.0 (no boost) */
  dmBoost?: number;
  /** Enable comma-separated matching for channel names. When enabled, query "a,b" matches channel name "a,c,b". Default: false */
  commaSeparatedChannelMatch?: boolean;
  /** Function to calculate per-item boost. Returns a boost multiplier (e.g., 0.2 for +20% boost). Default: undefined */
  boostFn?: BoostFn<T>;
}

type FreshSortConfigWithDefaults = Required<FreshSortConfig<unknown>>;

export interface TimestampedItem {
  updatedAt?: DateValue | null;
  viewedAt?: DateValue | null;
  lastInteraction?: DateValue | null;
}

export interface FreshSortResult<T> {
  item: T;
  fuzzyScore: number;
  timeScore: number;
  brevityScore: number;
  combinedScore: number;
  fuzzyResult?: FilterResult<T>;
}

const DEFAULT_CONFIG = {
  fuzzyWeight: 0.7,
  timeWeight: 0.3,
  brevityWeight: 0.0,
  timeDecayFactor: 0.5,
  maxAge: { value: 30, unit: 'd' },
  minFuzzyThreshold: 0.1,
  useViewedAt: false,
  channelBoost: 1.0,
  dmBoost: 1.0,
  commaSeparatedChannelMatch: false,
  boostFn: undefined,
} as const;

function extractTimestamp(
  item: TimestampedItem,
  useViewedAt: boolean = false
): DateValue | null {
  if (useViewedAt) {
    return item.viewedAt ?? item.updatedAt ?? item.lastInteraction ?? null;
  }

  return item.updatedAt ?? item.lastInteraction ?? null;
}

function calculateTimeScore(
  timestamp: DateValue | null,
  config: FreshSortConfigWithDefaults
): number {
  if (!timestamp) return 0;

  const now = new Date();
  const ageMs = Math.max(0, differenceInMilliseconds(now, timestamp));
  const maxAgeMs = parsedDurationToMilliseconds(config.maxAge);

  if (ageMs >= maxAgeMs) {
    return 0;
  }

  // exponential decay: e^(-decay * normalizedAge)
  const normalizedAge = ageMs / maxAgeMs;
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

function freshSort<T>(
  filterResults: FilterResult<T>[],
  config: FreshSortConfig<T> = {},
  isChannelItem: BooleanFn<T>,
  isDmItem: BooleanFn<T>,
  getTimestamp: TimestampFn<T>
): FreshSortResult<T>[] {
  const finalConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  } as FreshSortConfigWithDefaults;
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
    const timestampInfo = getTimestamp(result.original);
    const rawScore = result.score === Infinity ? maxFuzzyScore : result.score;
    const fuzzyScore =
      maxFuzzyScore === 0 ? 0 : normalizeFuzzyScore(rawScore, maxFuzzyScore);
    const timeScore = calculateTimeScore(
      extractTimestamp(timestampInfo, finalConfig.useViewedAt),
      finalConfig
    );

    const textForBrevity = result.string || '';
    const brevityScore = calculateBrevityScore(textForBrevity);

    // Apply fuzzy threshold penalty
    const fuzzyPenalty = fuzzyScore < finalConfig.minFuzzyThreshold ? 0.1 : 1;

    const channelMultiplier = isChannelItem(result.original)
      ? finalConfig.channelBoost
      : 1.0;

    const dmMultiplier = isDmItem(result.original) ? finalConfig.dmBoost : 1.0;

    // Apply per-item boost if boostFn is provided
    const itemBoost = finalConfig.boostFn
      ? finalConfig.boostFn(result.original)
      : 0;

    const combinedScore =
      (normalizedFuzzyWeight * fuzzyScore +
        normalizedTimeWeight * timeScore +
        normalizedBrevityWeight * brevityScore) *
      fuzzyPenalty *
      channelMultiplier *
      dmMultiplier *
      (1 + itemBoost);

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

export interface CreateFreshSearchArgs<T> {
  config?: FreshSortConfig<T>;
  getName: NameFn<T>;
  isChannelItem?: BooleanFn<T>;
  isDmItem?: BooleanFn<T>;
  getTimestamp: TimestampFn<T>;
}

export function createFreshSearch<T>({
  config = {},
  getName,
  isChannelItem = () => false,
  isDmItem = () => false,
  getTimestamp,
}: CreateFreshSearchArgs<T>) {
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
          const name = getName(item);
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
        extract: getName,
      });

      // Combine results
      const allResults = [...channelResults, ...nonChannelResults];
      return freshSort(
        allResults,
        config,
        isChannelItem,
        isDmItem,
        getTimestamp
      );
    }

    const fuzzyResults = fuzzy.filter(query, items, {
      extract: getName,
    });
    return freshSort(
      fuzzyResults,
      config,
      isChannelItem,
      isDmItem,
      getTimestamp
    );
  };
}

/**
 * Creates a boost function that gives a bonus to items with emails matching the current user's domain.
 * @param currentUserDomain - Accessor returning the current user's email domain (e.g., "example.com")
 * @param boost - The boost multiplier to apply (default: 0.5 for +50% boost)
 * @param getEmail - Function to extract email from item (default: assumes item.data.email)
 */
export function createSameDomainBoostFn<T>(
  currentUserDomain: Accessor<string | undefined>,
  boost: number = 0.5,
  getEmail: EmailFn<T>
): BoostFn<T> {
  return (item: T) => {
    const userDomain = currentUserDomain();
    if (!userDomain) return 0;
    const email = getEmail(item);
    const itemDomain = email?.split('@')[1];
    return itemDomain === userDomain ? boost : 0;
  };
}

/**
 * Preset configurations for common fresh search use cases.
 */
export const FreshSearchPresets = {
  /**
   * Base user search - balances fuzzy matching with recency, includes same-domain boost.
   * Good for recipient selectors, user pickers, and @mention menus.
   */
  baseUserSearch: <T>(
    currentUserDomain: Accessor<string | undefined>,
    getEmail: EmailFn<T>
  ): FreshSortConfig<T> => ({
    fuzzyWeight: 0.5,
    timeWeight: 0.4,
    brevityWeight: 0.1,
    boostFn: createSameDomainBoostFn<T>(currentUserDomain, 0.5, getEmail),
  }),
} as const;

/**
 * Deterministic per-row name matching blended with freshness and surface boosts.
 */

import uFuzzy from '@leeoniya/ufuzzy';
import { differenceInMilliseconds } from 'date-fns';
import type { Accessor } from 'solid-js';
import type { DateValue } from './date';
import {
  type ParsedDuration,
  parsedDurationToMilliseconds,
} from './dateSearch/dateParser';
import { fuzzyScoreCommaSpaceSeparated } from './fuzzy';
import { nameMatchQuality, normalizeNameText } from './name-match-score';

const fuzzyEligibility = new uFuzzy({});

interface FuzzyFilterResult<T> {
  original: T;
  string: string;
  score: number;
}

type BoostFn<T> = (item: T) => number;

type NameFn<T> = (item: T) => string;

type TimestampFn<T> = (item: T) => TimestampedItem;

type BooleanFn<T> = (item: T) => boolean;

type EmailFn<T> = (item: T) => string | undefined;

export interface FreshSortConfig<T = unknown> {
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
  /** Also match channel names holding every query term in any order, and rank channels whose participants the query names exactly above all but exact names. When enabled, query "b,a" matches channel name "a,c,b", which the fuzzy matcher alone misses. Default: false */
  commaSeparatedChannelMatch?: boolean;
  /** Function to calculate per-item boost. Returns a boost multiplier (e.g., 0.2 for +20% boost). Default: undefined */
  boostFn?: BoostFn<T>;
  /** How much to penalize matches with gaps between characters (0-1). Higher values penalize spread-out matches more. Default: 0 */
  gapPenaltyWeight?: number;
  /** How much to penalize matches that start later in the string. Higher values penalize later starts more. Default: 0 */
  startBonusDecay?: number;
  /** Rank names equal to the query first, then names starting with it, then other matches, ignoring case; the blended score orders each group. People whose first name equals the query count as equal to it. Default: false */
  rankNameMatchesFirst?: boolean;
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
  /** 3 for an exact name or person's first name, 2 for a participant set, 1 for a name starting with the query, else 0. Without `rankNameMatchesFirst` only participant sets rank above 0, under `commaSeparatedChannelMatch`. */
  nameMatchRank: number;
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
  gapPenaltyWeight: 0,
  startBonusDecay: 0,
  rankNameMatchesFirst: false,
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
  config: FreshSortConfigWithDefaults,
  now: Date
): number {
  if (timestamp == null) return 0;

  const ageMs = Math.max(0, differenceInMilliseconds(now, timestamp));
  if (!Number.isFinite(ageMs)) return 0;
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

/** Whether a query names everyone in a comma-separated channel name, in any
 * order: each term starts a word of some participant and every participant has
 * a term of their own, so a group with more people than the query names does
 * not qualify, even when one term starts several of their names. */
function namesEveryParticipant(normalizedName: string, term: string): boolean {
  const participants = normalizedName
    .split(',')
    .map((participant) => participant.trim().split(/\s+/));
  if (participants.length < 2) return false;

  const terms = term.split(/[\s,]+/).filter(Boolean);
  if (terms.length < participants.length) return false;

  const startsWordOf = (queryTerm: string, words: string[]) =>
    words.some((word) => word.startsWith(queryTerm));
  if (
    !terms.every((queryTerm) =>
      participants.some((words) => startsWordOf(queryTerm, words))
    )
  ) {
    return false;
  }

  // Bipartite matching by augmenting paths: a term taken by an earlier
  // participant is freed when that participant can move to another term.
  const holderOfTerm = new Map<number, number>();
  const assignTerm = (participant: number, triedTerms: Set<number>): boolean =>
    terms.some((queryTerm, termIndex) => {
      if (triedTerms.has(termIndex)) return false;
      if (!startsWordOf(queryTerm, participants[participant])) return false;
      triedTerms.add(termIndex);

      const holder = holderOfTerm.get(termIndex);
      if (holder !== undefined && !assignTerm(holder, triedTerms)) return false;

      holderOfTerm.set(termIndex, participant);
      return true;
    });

  return participants.every((_, participant) =>
    assignTerm(participant, new Set())
  );
}

function containsEveryTerm(normalizedText: string, term: string): boolean {
  return term
    .split(/[\s,]+/)
    .filter(Boolean)
    .every((word) => normalizedText.includes(word));
}

function calculateNameMatchRank(
  normalizedName: string,
  term: string,
  isPerson: boolean
): number {
  if (!term) return 0;
  if (normalizedName === term) return 3;

  // A comma lists several people, so its first word is only one person's name.
  const namesOnePerson = isPerson && !normalizedName.includes(',');
  if (namesOnePerson && normalizedName.split(/\s+/)[0] === term) return 3;

  if (normalizedName.startsWith(term)) return 1;
  return 0;
}

function calculateBrevityScore(text: string): number {
  if (!text || text.length === 0) return 0;
  const maxLength = 100;
  const normalizedLength = Math.min(text.length, maxLength) / maxLength;
  return Math.exp(-2 * normalizedLength);
}

function filterNameMatches<T>(
  items: T[],
  getName: NameFn<T>,
  getDisplayName: NameFn<T>,
  query: string,
  gapPenaltyWeight: number,
  startBonusDecay: number
): FuzzyFilterResult<T>[] {
  return items.flatMap((item) => {
    const text = getName(item);
    const label = getDisplayName === getName ? text : getDisplayName(item);
    const quality = nameMatchQuality(
      label,
      text,
      query,
      gapPenaltyWeight,
      startBonusDecay
    );
    return quality === undefined
      ? []
      : [{ original: item, string: text, score: quality * 100 }];
  });
}

/** Channels holding every query term out of order, which uFuzzy skips. Rows it
 * matched keep their score, so this only adds to its results. */
function outOfOrderChannelMatches<T>(
  items: T[],
  fuzzyResults: FuzzyFilterResult<T>[],
  query: string,
  getName: NameFn<T>,
  isChannelItem: BooleanFn<T>
): FuzzyFilterResult<T>[] {
  const fuzzyMatched = new Set(fuzzyResults.map((result) => result.original));
  return items.flatMap((item) => {
    if (!isChannelItem(item) || fuzzyMatched.has(item)) return [];

    const name = getName(item);
    const score = fuzzyScoreCommaSpaceSeparated(query, name);
    if (score < 0) return [];

    return [{ original: item, string: name, score: score * 100 }];
  });
}

function freshSort<T>(
  filterResults: FuzzyFilterResult<T>[],
  getNameMatchRank: (item: T) => number,
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

  // A row keeps the same score in every window and corpus.
  const maxFuzzyScore = 100;

  const now = new Date();
  const scoredResults: FreshSortResult<T>[] = filterResults.map((result) => {
    const timestampInfo = getTimestamp(result.original);
    const rawScore = result.score === Infinity ? maxFuzzyScore : result.score;
    const fuzzyScore = normalizeFuzzyScore(rawScore, maxFuzzyScore);
    const timeScore = calculateTimeScore(
      extractTimestamp(timestampInfo, finalConfig.useViewedAt),
      finalConfig,
      now
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
      nameMatchRank: getNameMatchRank(result.original),
    };
  });

  scoredResults.sort(
    (a, b) =>
      b.nameMatchRank - a.nameMatchRank || b.combinedScore - a.combinedScore
  );
  return scoredResults;
}

interface CreateFreshSearchArgs<T> {
  config?: FreshSortConfig<T>;
  getName: NameFn<T>;
  /** The label people see, for name-match ranking and match position when `getName` adds aliases, emails, or keywords. Default: getName */
  getDisplayName?: NameFn<T>;
  isChannelItem?: BooleanFn<T>;
  isDmItem?: BooleanFn<T>;
  /** Rows named after a person, whose first name alone counts as an exact name under `rankNameMatchesFirst`. Default: none */
  isPersonItem?: BooleanFn<T>;
  getTimestamp: TimestampFn<T>;
}

export function createFreshSearch<T>({
  config = {},
  getName,
  getDisplayName = getName,
  isChannelItem = () => false,
  isDmItem = () => false,
  isPersonItem = () => false,
  getTimestamp,
}: CreateFreshSearchArgs<T>) {
  return (items: T[], query: string): FreshSortResult<T>[] => {
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    const trimmedQuery = normalizeNameText(query);
    const term = trimmedQuery;
    const getNameMatchRank = (item: T) => {
      const name = normalizeNameText(getDisplayName(item));
      let nameRank = finalConfig.rankNameMatchesFirst
        ? calculateNameMatchRank(name, term, isPersonItem(item))
        : 0;
      // Letters scattered across a row match as a subsequence. Such a row
      // never outranks one that contains the typed words themselves.
      if (
        finalConfig.rankNameMatchesFirst &&
        nameRank === 0 &&
        !containsEveryTerm(normalizeNameText(getName(item)), term)
      )
        nameRank = -1;
      const namesParticipants =
        finalConfig.commaSeparatedChannelMatch &&
        isChannelItem(item) &&
        namesEveryParticipant(name, term);

      return namesParticipants ? Math.max(nameRank, 2) : nameRank;
    };

    const hasComma = trimmedQuery.includes(',');
    const hasSpace = trimmedQuery.includes(' ');
    const hasTerms = /[^\s,]/.test(trimmedQuery);
    const useMultiTermChannelMatch =
      finalConfig.commaSeparatedChannelMatch &&
      hasTerms &&
      (hasComma || hasSpace);

    if (!trimmedQuery) {
      const allResults: FuzzyFilterResult<T>[] = items.map((item) => ({
        original: item,
        string: getName(item),
        score: 100,
      }));
      return freshSort(
        allResults,
        getNameMatchRank,
        config,
        isChannelItem,
        isDmItem,
        getTimestamp
      );
    }

    if (finalConfig.commaSeparatedChannelMatch && !hasTerms) return [];

    // Multi-person channel matching adds reversed participant terms without
    // widening other local entity rows. Single-token subsequences retain the
    // shared corpus-independent matcher used by cached/local rows.
    const eligible = useMultiTermChannelMatch
      ? (fuzzyEligibility.filter(items.map(getName), trimmedQuery) ?? []).map(
          (index) => items[index]
        )
      : items;
    const fuzzyResults = filterNameMatches(
      eligible,
      getName,
      getDisplayName,
      trimmedQuery,
      finalConfig.gapPenaltyWeight,
      finalConfig.startBonusDecay
    );
    const results = useMultiTermChannelMatch
      ? [
          ...fuzzyResults,
          ...outOfOrderChannelMatches(
            items,
            fuzzyResults,
            trimmedQuery,
            getName,
            isChannelItem
          ),
        ]
      : fuzzyResults;
    return freshSort(
      results,
      getNameMatchRank,
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
function createSameDomainBoostFn<T>(
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
 * How closely a typed query matches an item's name: exact names, then names
 * starting with the query, then tight matches near the start. Menus that find
 * entities by name (Command-K, mobile name search, @ mentions) share this and
 * keep their own recency weights and type boosts.
 */
export const NAME_MATCH_RANKING = {
  gapPenaltyWeight: 0.4,
  startBonusDecay: 0.2,
  rankNameMatchesFirst: true,
} as const satisfies FreshSortConfig;

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

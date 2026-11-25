import { fireAndForget } from '@core/util/fireAndForget';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import {
  type Accessor,
  createComputed,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import {
  buildChannelTriageRequest,
  buildOrganizeSuggestionRequest,
  estimateJevUsage,
  heuristicOrganizeSuggestion,
  interpretChannelTriageResponse,
  JEV_MAX_BURST_CHANNELS,
  JEV_MAX_CACHE_ENTRIES,
  JEV_MAX_CONCURRENCY,
  type JevDecisionPayload,
  type OrganizeSuggestion,
  selectChannelsForJevTriage,
  triageCacheKey,
} from '../core/jev-triage';
import type {
  ChannelTriageResult,
  SidebarChannel,
  SidebarSection,
  TriageEngineStatus,
} from '../core/sidebar-model';
import { resolveSenderRole } from '../core/support-triage';

const CACHE_STORAGE_KEY = 'macro:channels:jev-triage-cache:v1';
const CACHE_SCHEMA_VERSION = 1;
const LIVE_DEBOUNCE_MS = 10_000;

export type JevDecideOutcome =
  | { ok: true; probabilities: Record<string, number> }
  | { ok: false; unavailable: boolean };

export type JevDecidePort = (
  payload: JevDecisionPayload,
  signal: AbortSignal
) => Promise<JevDecideOutcome>;

export type TriageCacheStorage = {
  read: (userId: string) => string | null;
  write: (userId: string, value: string) => void;
};

const defaultCacheStorage: TriageCacheStorage =
  createUserScopedStorage(CACHE_STORAGE_KEY);

type PersistedCacheShape = {
  version: number;
  entries: ChannelTriageResult[];
};

function loadCache(
  storage: TriageCacheStorage,
  userId: string | undefined
): Map<string, ChannelTriageResult> {
  const map = new Map<string, ChannelTriageResult>();
  if (!userId) return map;
  const raw = storage.read(userId);
  if (!raw) return map;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedCacheShape>;
    if (
      parsed.version !== CACHE_SCHEMA_VERSION ||
      !Array.isArray(parsed.entries)
    ) {
      return map;
    }
    for (const entry of parsed.entries) {
      if (
        entry &&
        typeof entry.channelId === 'string' &&
        typeof entry.messageId === 'string' &&
        entry.scores &&
        typeof entry.scores.needsReply === 'number'
      ) {
        map.set(triageCacheKey(entry.channelId, entry.messageId), entry);
      }
    }
  } catch {
    return map;
  }
  return map;
}

function saveCache(
  storage: TriageCacheStorage,
  userId: string | undefined,
  entries: ReadonlyMap<string, ChannelTriageResult>
) {
  if (!userId) return;
  const sorted = [...entries.values()]
    .sort((left, right) => right.classifiedAtMs - left.classifiedAtMs)
    .slice(0, JEV_MAX_CACHE_ENTRIES);
  storage.write(
    userId,
    JSON.stringify({
      version: CACHE_SCHEMA_VERSION,
      entries: sorted,
    } satisfies PersistedCacheShape)
  );
}

export type JevTriageStats = {
  jevCallsThisSession: number;
  cachedCount: number;
  inFlight: number;
  estimatedTokens: number;
  estimatedCostFormatted: string;
};

export type JevTriageController = {
  /** Latest valid triage result per channel ID (matched to current messageId). */
  triageByChannelId: Accessor<ReadonlyMap<string, ChannelTriageResult>>;
  engineStatus: Accessor<TriageEngineStatus>;
  stats: Accessor<JevTriageStats>;
  /** Force a fresh Jev pass for uncached active channels (and clear fallback hold). */
  refresh: () => void;
  /** On-demand Smart Organize suggestions for ungrouped channels. */
  suggestOrganization: (
    ungrouped: readonly SidebarChannel[],
    existingSections: readonly SidebarSection[]
  ) => Promise<{
    suggestions: OrganizeSuggestion[];
    usedJevCount: number;
    estimatedCostFormatted: string;
  }>;
};

/**
 * Bounded, content-addressed, account-fenced Jev triage controller.
 *
 * - Reloads hit localStorage cache by `(channelId, latestMessageId)` with 0
 *   network requests and 0 flicker.
 * - Limits bursts to `JEV_MAX_BURST_CHANNELS` (25) with concurrency 3.
 * - Debounces live tail changes by 10s so rapid typing never fires per-message.
 * - Gracefully degrades to `'heuristic'` on HTTP 503/402/network unavailability
 *   without spamming errors.
 */
export function createJevTriageController(options: {
  accountKey: Accessor<string | undefined>;
  userId: Accessor<string | undefined>;
  enabled: Accessor<boolean>;
  channels: Accessor<readonly SidebarChannel[]>;
  supportChannelIds: Accessor<ReadonlySet<string>>;
  unreadOrMentionedIds: Accessor<ReadonlySet<string>>;
  mentionCounts: Accessor<ReadonlyMap<string, number>>;
  teamMemberIds: Accessor<ReadonlySet<string>>;
  decide: JevDecidePort;
  storage?: TriageCacheStorage;
  debounceMs?: number;
  now?: () => number;
}): JevTriageController {
  const storage = options.storage ?? defaultCacheStorage;
  const debounceMs = options.debounceMs ?? LIVE_DEBOUNCE_MS;
  const now = options.now ?? (() => Date.now());

  const [cacheVersion, setCacheVersion] = createSignal(0);
  const [engineStatus, setEngineStatus] = createSignal<TriageEngineStatus>(
    options.enabled() ? 'idle' : 'paused'
  );
  const [jevCallsThisSession, setJevCallsThisSession] = createSignal(0);
  const [inFlight, setInFlight] = createSignal(0);
  const [refreshTick, setRefreshTick] = createSignal(0);

  let cache = loadCache(storage, options.userId());
  const inFlightKeys = new Set<string>();
  let activeAccountKey = options.accountKey();
  let activeController: AbortController | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let hasRunInitialPass = false;
  let unavailableHold = false;
  let pendingRescan = false;
  let disposed = false;

  const abortInFlight = () => {
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
    if (activeController) {
      activeController.abort();
      activeController = undefined;
    }
    inFlightKeys.clear();
    pendingRescan = false;
    setInFlight(0);
  };

  onCleanup(() => {
    disposed = true;
    abortInFlight();
  });

  // Fence against account / login session changes synchronously before effects run.
  createComputed(
    on(
      options.accountKey,
      (nextAccountKey) => {
        if (nextAccountKey === activeAccountKey) return;
        abortInFlight();
        activeAccountKey = nextAccountKey;
        hasRunInitialPass = false;
        unavailableHold = false;
        cache = loadCache(storage, options.userId());
        setJevCallsThisSession(0);
        setEngineStatus(options.enabled() ? 'idle' : 'paused');
        setCacheVersion((version) => version + 1);
      },
      { defer: true }
    )
  );

  const runBatch = async (
    candidates: readonly SidebarChannel[],
    expectedAccountKey: string | undefined,
    expectedUserId: string | undefined
  ) => {
    if (candidates.length === 0) return;

    const controller = new AbortController();
    activeController = controller;
    let cursor = 0;
    let anySucceeded = false;
    let hitUnavailable = false;

    const worker = async () => {
      while (!disposed && !controller.signal.aborted && !hitUnavailable) {
        const index = cursor++;
        if (index >= candidates.length) break;
        const channel = candidates[index];
        const msg = channel.latestMessage;
        if (!msg) continue;

        const key = triageCacheKey(channel.id, msg.messageId);
        if (cache.has(key) || inFlightKeys.has(key)) continue;

        const senderRole = resolveSenderRole({
          channel,
          currentUserId: expectedUserId,
          teamMemberIds: options.teamMemberIds(),
        });

        const payload = buildChannelTriageRequest({
          channel,
          isSupport: options.supportChannelIds().has(channel.id),
          senderRole,
          mentionedCurrentUser:
            (options.mentionCounts().get(channel.id) ?? 0) > 0,
          nowMs: now(),
        });

        inFlightKeys.add(key);
        setInFlight((count) => count + 1);
        try {
          const outcome = await options.decide(payload, controller.signal);
          if (
            disposed ||
            controller.signal.aborted ||
            options.accountKey() !== expectedAccountKey
          ) {
            return;
          }

          if (outcome.ok) {
            anySucceeded = true;
            setJevCallsThisSession((count) => count + 1);
            const result = interpretChannelTriageResponse({
              channelId: channel.id,
              messageId: msg.messageId,
              probabilities: outcome.probabilities,
              nowMs: now(),
            });
            cache.set(key, result);
            setCacheVersion((version) => version + 1);
          } else if (outcome.unavailable) {
            hitUnavailable = true;
            unavailableHold = true;
            setEngineStatus('heuristic');
            controller.abort();
            return;
          }
        } finally {
          inFlightKeys.delete(key);
          setInFlight((count) => Math.max(0, count - 1));
        }
      }
    };

    const concurrency = Math.min(JEV_MAX_CONCURRENCY, candidates.length);
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    if (disposed || options.accountKey() !== expectedAccountKey) return;
    if (activeController === controller) activeController = undefined;

    if (anySucceeded) {
      saveCache(storage, expectedUserId, cache);
      if (!hitUnavailable) setEngineStatus('jev');
    }

    if (pendingRescan && !hitUnavailable && options.enabled()) {
      pendingRescan = false;
      setRefreshTick((tick) => tick + 1);
    }
  };

  // Trigger bounded triage passes when active/support tails change.
  createEffect(() => {
    refreshTick();
    const enabled = options.enabled();
    const accountKey = options.accountKey();
    const userId = options.userId();
    const channels = options.channels();
    const supportChannelIds = options.supportChannelIds();
    const unreadOrMentionedIds = options.unreadOrMentionedIds();

    if (!enabled) {
      abortInFlight();
      setEngineStatus('paused');
      return;
    }

    if (!accountKey || !userId) return;
    if (unavailableHold) {
      setEngineStatus('heuristic');
      return;
    }

    const skipKeys = new Set<string>([...cache.keys(), ...inFlightKeys]);
    const candidates = selectChannelsForJevTriage({
      channels,
      supportChannelIds,
      unreadOrMentionedIds,
      currentUserId: userId,
      cachedKeys: skipKeys,
      maxBurst: JEV_MAX_BURST_CHANNELS,
    });

    if (candidates.length === 0) {
      if (cache.size > 0 && engineStatus() === 'idle') {
        setEngineStatus('jev');
      }
      return;
    }

    if (activeController) {
      pendingRescan = true;
      return;
    }

    const start = () => {
      if (
        disposed ||
        options.accountKey() !== accountKey ||
        !options.enabled() ||
        activeController
      ) {
        return;
      }
      hasRunInitialPass = true;
      fireAndForget(runBatch(candidates, accountKey, userId), 'channels-jev');
    };

    if (!hasRunInitialPass || debounceMs <= 0) {
      start();
      return;
    }

    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      start();
    }, debounceMs);
  });

  const triageByChannelId = createMemo<
    ReadonlyMap<string, ChannelTriageResult>
  >(() => {
    cacheVersion();
    const map = new Map<string, ChannelTriageResult>();
    for (const channel of options.channels()) {
      const msgId = channel.latestMessage?.messageId;
      if (!msgId) continue;
      const hit = cache.get(triageCacheKey(channel.id, msgId));
      if (hit) map.set(channel.id, hit);
    }
    return map;
  });

  const stats = createMemo<JevTriageStats>(() => {
    cacheVersion();
    const calls = jevCallsThisSession();
    const usage = estimateJevUsage(calls);
    return {
      jevCallsThisSession: calls,
      cachedCount: cache.size,
      inFlight: inFlight(),
      estimatedTokens: usage.tokens,
      estimatedCostFormatted: usage.formattedUsd,
    };
  });

  const refresh = () => {
    unavailableHold = false;
    hasRunInitialPass = false;
    setEngineStatus(options.enabled() ? 'idle' : 'paused');
    setRefreshTick((tick) => tick + 1);
  };

  const suggestOrganization = async (
    ungrouped: readonly SidebarChannel[],
    existingSections: readonly SidebarSection[]
  ): Promise<{
    suggestions: OrganizeSuggestion[];
    usedJevCount: number;
    estimatedCostFormatted: string;
  }> => {
    const manualSections = existingSections.filter(
      (section) => !section.ruleContains
    );
    const eligible = ungrouped
      .filter(
        (channel) =>
          channel.channelType !== 'direct_message' && channel.isParticipant
      )
      .slice(0, JEV_MAX_BURST_CHANNELS);

    const suggestions: OrganizeSuggestion[] = [];
    let usedJevCount = 0;
    const expectedAccount = options.accountKey();
    const controller = new AbortController();
    let jevUnavailable = !options.enabled() || unavailableHold;

    for (const channel of eligible) {
      if (disposed || options.accountKey() !== expectedAccount) break;

      if (!jevUnavailable) {
        const { payload, keyToTarget } = buildOrganizeSuggestionRequest(
          channel,
          manualSections
        );
        if (Object.keys(payload.questions).length > 0) {
          const outcome = await options.decide(payload, controller.signal);
          if (disposed || options.accountKey() !== expectedAccount) break;
          if (outcome.ok) {
            usedJevCount += 1;
            setJevCallsThisSession((count) => count + 1);
            let bestKey: string | undefined;
            let bestScore = 0.58;
            for (const [key, score] of Object.entries(outcome.probabilities)) {
              if (typeof score === 'number' && score > bestScore) {
                bestScore = score;
                bestKey = key;
              }
            }
            const target = bestKey ? keyToTarget.get(bestKey) : undefined;
            if (target) {
              suggestions.push({
                channelId: channel.id,
                channelName: channel.name,
                target,
                confidence: bestScore,
                source: 'jev',
              });
              continue;
            }
          } else if (outcome.unavailable) {
            jevUnavailable = true;
            unavailableHold = true;
            setEngineStatus('heuristic');
          }
        }
      }

      const fallback = heuristicOrganizeSuggestion(channel, manualSections);
      if (fallback) suggestions.push(fallback);
    }

    return {
      suggestions,
      usedJevCount,
      estimatedCostFormatted: estimateJevUsage(usedJevCount).formattedUsd,
    };
  };

  return {
    triageByChannelId,
    engineStatus,
    stats,
    refresh,
    suggestOrganization,
  };
}

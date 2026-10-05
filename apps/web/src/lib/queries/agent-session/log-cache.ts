/**
 * The raw log of every session the viewer opened, kept in IndexedDB so the
 * next open folds it before the fetched log lands.
 *
 * Raw rows rather than folded messages: the fold owns the derivation, and a
 * machine fed the cached snapshot and then the fetched one reconciles the
 * two by row id, so a cache from an older fold never shows a stale shape.
 * Entries carry the user who saved them and are read back only for that
 * user; logout clears them all. A sweep on first use drops entries past
 * their time-to-live and, beyond the cap, the oldest, so a long-lived
 * browser profile does not grow without bound.
 */

import {
  enableAgentSessionLogCache,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import {
  IDBSnapshotStore,
  type ScopedSnapshot,
} from '@macro-inc/browser-store/snapshot-store';
import type {
  AgentSessionLogEntryDto,
  AgentSessionResponse,
  SessionBot,
} from '@service-agent-harness/generated/schemas';
import { authKeys } from '../auth/keys';
import type { UserInfoData } from '../auth/user-info';
import { hasCachedUserIdentity } from '../auth/user-info-cache';
import { queryClient } from '../client';

export const AGENT_SESSION_LOG_CACHE_DB_NAME = 'macro-agent-session-log-v1';
/** Entries older than this are dropped by the sweep and ignored by reads. */
export const AGENT_SESSION_LOG_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Beyond this many sessions the sweep drops the oldest. */
export const AGENT_SESSION_LOG_CACHE_MAX_SESSIONS = 50;
/**
 * A session longer than this is not cached. Tool output rides inline in
 * the rows, so a runaway session could otherwise take the whole quota.
 */
export const AGENT_SESSION_LOG_CACHE_MAX_ROWS = 100_000;

/** What the load needs to render a session before the network answers. */
export type SessionLogSnapshot = {
  session: AgentSessionResponse;
  bot: SessionBot;
  rows: AgentSessionLogEntryDto[];
};

export type CachedSessionLog = SessionLogSnapshot & {
  userId: string;
  savedAt: number;
};

export type AgentSessionLogCache = {
  /** The saved log for `sessionId`, if one exists for the current user. */
  read(sessionId: string): Promise<SessionLogSnapshot | undefined>;
  /** Save `log` for the current user, replacing whatever was there. */
  write(sessionId: string, log: SessionLogSnapshot): Promise<void>;
  remove(sessionId: string): Promise<void>;
  /** Drop every user's entries: logout. */
  clear(): Promise<void>;
};

/** Which entries a sweep keeps: unexpired, and the newest up to the cap. */
export function selectExpired(
  saved: ScopedSnapshot<CachedSessionLog>[],
  now: number,
  limits: { ttlMs: number; maxSessions: number }
): string[] {
  const cutoff = now - limits.ttlMs;
  const live = saved.filter((row) => row.snapshot.savedAt >= cutoff);
  const overflow = [...live]
    .sort((a, b) => b.snapshot.savedAt - a.snapshot.savedAt)
    .slice(limits.maxSessions);
  return [
    ...saved
      .filter((row) => row.snapshot.savedAt < cutoff)
      .map((row) => row.scopeId),
    ...overflow.map((row) => row.scopeId),
  ];
}

export function createAgentSessionLogCache(options: {
  dbName: string;
  /** The signed-in user, or nothing while there is none to fence by. */
  identity: () => string | undefined;
  enabled: () => boolean;
  now?: () => number;
}): AgentSessionLogCache {
  const now = options.now ?? Date.now;
  const store = (sessionId: string) =>
    new IDBSnapshotStore<CachedSessionLog>(options.dbName, sessionId);
  let swept = false;

  const sweep = async () => {
    if (swept) return;
    swept = true;
    try {
      await IDBSnapshotStore.prune<CachedSessionLog>(options.dbName, (saved) =>
        selectExpired(saved, now(), {
          ttlMs: AGENT_SESSION_LOG_CACHE_TTL_MS,
          maxSessions: AGENT_SESSION_LOG_CACHE_MAX_SESSIONS,
        })
      );
    } catch (error) {
      console.warn('[agent-session] log cache sweep failed', error);
    }
  };

  return {
    async read(sessionId) {
      if (!options.enabled()) return;
      const userId = options.identity();
      if (!userId) return;
      const cached = await store(sessionId).load();
      // Sweeping after the read keeps it off the open's critical path.
      void sweep();
      if (!cached || cached.userId !== userId) return;
      if (cached.savedAt < now() - AGENT_SESSION_LOG_CACHE_TTL_MS) return;
      return { session: cached.session, bot: cached.bot, rows: cached.rows };
    },
    async write(sessionId, log) {
      if (!options.enabled()) return;
      const userId = options.identity();
      if (!userId) return;
      if (log.rows.length > AGENT_SESSION_LOG_CACHE_MAX_ROWS) {
        // A shorter, older copy must not outlive the session it no longer
        // describes.
        await store(sessionId).delete();
        return;
      }
      await store(sessionId).save({ ...log, userId, savedAt: now() });
    },
    remove(sessionId) {
      return store(sessionId).delete();
    },
    async clear() {
      try {
        await IDBSnapshotStore.clear(options.dbName);
      } catch (error) {
        // Entries are fenced to the user who saved them, so a store that
        // cannot be cleared (no IndexedDB, a failing one) stays unreadable
        // to the next account; logout must not hang on it.
        console.error('[agent-session] log cache could not be cleared', error);
      }
    },
  };
}

function currentUserId(): string | undefined {
  const data = queryClient.getQueryState<UserInfoData>(
    authKeys.userInfo.queryKey
  )?.data;
  return data !== undefined && hasCachedUserIdentity(data)
    ? data.id
    : undefined;
}

export const agentSessionLogCache = createAgentSessionLogCache({
  dbName: AGENT_SESSION_LOG_CACHE_DB_NAME,
  identity: currentUserId,
  enabled: () => isFeatureEnabled(enableAgentSessionLogCache),
});

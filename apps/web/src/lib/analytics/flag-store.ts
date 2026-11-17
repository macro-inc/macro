import { fireAndForget } from '@core/util/fireAndForget';
import {
  createUserScopedStorage,
  userScopedStorageKey,
} from '@core/util/userScopedStorage';
import { type Span, Telemetry } from '@macro-inc/observability';
import {
  batch,
  createEffect,
  createRoot,
  createSignal,
  startTransition,
} from 'solid-js';
import { z } from 'zod';

/**
 * Where the web app's remote flags come from, in order:
 *
 * 1. PostHog's answer this session (`remote`).
 * 2. The backend's evaluation for this account this session (`bootstrap`),
 *    read in parallel on a cold load (no PostHog cache) and whenever PostHog
 *    fails to answer.
 * 3. The last backend evaluation this browser saw for the account
 *    (`persisted_bootstrap`).
 * 4. What PostHog cached on an earlier visit (`cache`).
 *
 * The first source that has answered decides every flag; a flag it doesn't
 * list is off. Nothing answered means off, still loading until PostHog has
 * failed and no backend read is pending.
 *
 * A module-level store, like the analytics singleton it sits beside:
 * `isFeatureEnabled` reads it from queries and helpers outside any provider.
 */

export type FlagValue = boolean | string;
export type FlagValues = Readonly<Record<string, FlagValue>>;
export type FlagSource =
  | 'remote'
  | 'bootstrap'
  | 'persisted_bootstrap'
  | 'cache';
/** How one PostHog `/flags` request ended. */
export type FlagLoadOutcome = 'ok' | 'timeout' | 'blocked' | 'error';

/**
 * `stale`: PostHog answered for another identity (before sign-in, or for the
 * account that signed out). Its values still serve as a cache until it
 * answers for this account.
 */
type RemoteStatus = 'pending' | 'ok' | 'stale' | 'unreachable';
type BootstrapStatus = 'idle' | 'pending' | 'ok' | 'failed';
type BootstrapTrigger = 'cold' | 'fallback';

/** What the store needs from the PostHog client. */
export type FlagClient = {
  onFeatureFlags: (
    callback: (
      flags: string[],
      variants: Record<string, unknown>,
      context?: { errorsLoading?: boolean }
    ) => void
  ) => () => void;
  reloadFeatureFlags: () => void;
  get_distinct_id?: () => string;
  get_property?: (name: string) => unknown;
  featureFlags?: { getFlags: () => string[] };
};

/** The signed-in account whose flags the backend can evaluate. */
export type FlagAccount = {
  userId: string;
  fetchFlags: () => Promise<FlagValues>;
};

/**
 * A failed `/flags` request is retried after these delays until one
 * succeeds; then PostHog's own five-minute refresh takes over. PostHog stops
 * retrying a request that never gets a response (blocked) by itself.
 */
export const FLAG_RETRY_DELAYS_MS = [5_000, 30_000] as const;

/** How long PostHog's `/flags` request may take before it counts as failed. */
export const FEATURE_FLAG_REQUEST_TIMEOUT_MS = 10_000;

/**
 * A retry that gets no answer by then was never sent: PostHog stops sending
 * after repeated requests that got no response at all.
 */
const RETRY_ANSWER_TIMEOUT_MS = FEATURE_FLAG_REQUEST_TIMEOUT_MS + 5_000;

/** posthog-js persists the errors of the latest `/flags` request here. */
const POSTHOG_FLAG_ERRORS_PROPERTY = '$feature_flag_errors';

const flagValuesSchema = z.record(
  z.string(),
  z.union([z.boolean(), z.string()])
);

const PERSISTED_BOOTSTRAP_KEY = 'feature-flags:bootstrap:v1';
const persistedBootstrap = {
  ...createUserScopedStorage(PERSISTED_BOOTSTRAP_KEY),
  remove(userId: string) {
    try {
      localStorage.removeItem(
        userScopedStorageKey(PERSISTED_BOOTSTRAP_KEY, userId)
      );
    } catch {
      // Storage may be unavailable; then nothing was written either.
    }
  },
};

function readPersisted(userId: string): FlagValues | undefined {
  const raw = persistedBootstrap.read(userId);
  if (raw === null) return undefined;
  try {
    const parsed = flagValuesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function isOn(value: FlagValue | undefined): boolean {
  return value !== undefined && value !== false;
}

function classifyFailure(client: FlagClient): FlagLoadOutcome {
  const errors = client.get_property?.(POSTHOG_FLAG_ERRORS_PROPERTY);
  const list = Array.isArray(errors) ? errors : [];
  if (list.includes('timeout')) return 'timeout';
  if (list.includes('connection_error')) {
    // No response at all while online: an extension, filter list or network
    // blocked the request.
    return typeof navigator !== 'undefined' && navigator.onLine === false
      ? 'error'
      : 'blocked';
  }
  return 'error';
}

function failureDetail(client: FlagClient): string {
  const errors = client.get_property?.(POSTHOG_FLAG_ERRORS_PROPERTY);
  return Array.isArray(errors) ? errors.join(',') : '';
}

export function createFlagStore() {
  const [remote, setRemote] = createSignal<RemoteStatus>('pending');
  // PostHog's SDK is not reactive: readers track this to re-read it on each
  // answer, including payload changes that leave the flag list unchanged.
  const [revision, setRevision] = createSignal(0);
  const [unreachable, setUnreachable] = createSignal(false);
  const [bootstrapStatus, setBootstrapStatus] =
    createSignal<BootstrapStatus>('idle');
  const [bootstrap, setBootstrap] = createSignal<FlagValues>();
  const [persisted, setPersisted] = createSignal<FlagValues>();
  const [hadCache, setHadCache] = createSignal(false);

  let client: FlagClient | undefined;
  let account: FlagAccount | undefined;
  // Fences a backend answer that arrives after the account changed.
  let accountGeneration = 0;
  let attempt = 0;
  let loadSpan: Span | undefined;
  let resolveSpan: Span | undefined;
  let unreachableSince: number | undefined;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  /** Whether any source can answer a read now. */
  const settled = () => {
    if (remote() === 'ok' || remote() === 'stale') return true;
    if (bootstrapStatus() === 'ok') return true;
    if (persisted() !== undefined || hadCache()) return true;
    // PostHog failed: settle once no backend read is still on its way.
    return remote() === 'unreachable' && bootstrapStatus() !== 'pending';
  };

  /** The source that decides reads now, if any has answered. */
  const activeSource = (): FlagSource | undefined => {
    if (remote() === 'ok') return 'remote';
    if (bootstrapStatus() === 'ok') return 'bootstrap';
    if (persisted() !== undefined) return 'persisted_bootstrap';
    if (hadCache() || remote() === 'stale') return 'cache';
    return undefined;
  };

  function endResolveSpanIfSettled() {
    if (!resolveSpan || !settled()) return;
    resolveSpan.setAttr('flags.source', activeSource() ?? 'none');
    resolveSpan.setAttr('flags.remote', remote());
    resolveSpan.setAttr('flags.bootstrap', bootstrapStatus());
    resolveSpan.end();
    resolveSpan = undefined;
  }

  function startLoadSpan(startTime: number) {
    attempt += 1;
    loadSpan = Telemetry.span('feature_flags.load', {
      startTime,
      attributes: {
        'flags.attempt': attempt,
        'flags.had_cache': hadCache(),
      },
    });
  }

  function later(callback: () => void, delay: number) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
  }

  function scheduleRetry() {
    const delay = FLAG_RETRY_DELAYS_MS[attempt - 1];
    if (delay === undefined || !client) return;
    later(() => {
      if (!client || remote() === 'ok') return;
      startLoadSpan(Date.now());
      const span = loadSpan;
      client.reloadFeatureFlags();
      later(() => {
        if (!span || loadSpan !== span) return;
        span.setAttr('flags.outcome', 'blocked');
        span.setAttr('flags.errors', 'not_sent');
        span.end();
        loadSpan = undefined;
      }, RETRY_ANSWER_TIMEOUT_MS);
    }, delay);
  }

  async function readBootstrap(
    current: FlagAccount,
    generation: number,
    span: Span
  ) {
    let values: FlagValues;
    try {
      values = await current.fetchFlags();
    } catch (error) {
      span.setAttr('flags.outcome', 'error');
      span.error(error);
      if (generation !== accountGeneration) return;
      setBootstrapStatus('failed');
      endResolveSpanIfSettled();
      return;
    }
    span.setAttr('flags.outcome', 'ok');
    span.setAttr('flags.count', Object.keys(values).length);
    if (generation !== accountGeneration) return;
    // Kept for a later visit whose PostHog request fails too; once PostHog
    // answers, its own cache is fresher (see receiveRemote).
    if (remote() !== 'ok') {
      persistedBootstrap.write(current.userId, JSON.stringify(values));
    }
    // Like PostHog's answer, these swap flagged subtrees; a transition keeps
    // the painted UI until the new one is ready.
    await startTransition(() => {
      // The transition runs later; the account may have changed meanwhile.
      if (generation !== accountGeneration) return;
      setBootstrap(values);
      setBootstrapStatus('ok');
    });
    endResolveSpanIfSettled();
  }

  function startBootstrap(trigger: BootstrapTrigger) {
    if (!account || bootstrapStatus() !== 'idle') return;
    const current = account;
    const generation = accountGeneration;
    setBootstrapStatus('pending');
    // The HTTP request starts inside the span, so it joins its trace.
    fireAndForget(
      Telemetry.span(
        'feature_flags.bootstrap',
        { attributes: { 'flags.trigger': trigger } },
        (span) => readBootstrap(current, generation, span)
      ),
      'feature-flags'
    );
  }

  /** PostHog answered `/flags`; `errorsLoading` when it got no answer. */
  function receiveRemote(errorsLoading: boolean) {
    const outcome = errorsLoading && client ? classifyFailure(client) : 'ok';
    // Only a failure that ends an attempt this store started or awaited
    // schedules the next retry; PostHog's own reloads answer here too.
    const endsAttempt = loadSpan !== undefined;
    if (loadSpan) {
      loadSpan.setAttr('flags.outcome', errorsLoading ? outcome : 'ok');
      if (errorsLoading && client) {
        loadSpan.setAttr('flags.errors', failureDetail(client));
        loadSpan.setAttr(
          'flags.online',
          typeof navigator === 'undefined' || navigator.onLine !== false
        );
      }
      loadSpan.end();
      loadSpan = undefined;
    }
    if (!errorsLoading && remote() === 'unreachable' && unreachableSince) {
      Telemetry.span('feature_flags.recovered', {
        startTime: unreachableSince,
        attributes: { 'flags.attempt': attempt },
      }).end();
    }
    const firstAnswer = !errorsLoading && remote() !== 'ok';
    batch(() => {
      setUnreachable(errorsLoading);
      setRevision((value) => value + 1);
      // An answer earlier this session outranks a later failure.
      if (!errorsLoading) setRemote('ok');
      else if (remote() !== 'ok') setRemote('unreachable');
    });
    // PostHog's own cache now holds a fresher answer than an earlier
    // backend one.
    if (firstAnswer && account) persistedBootstrap.remove(account.userId);
    if (errorsLoading && remote() === 'unreachable') {
      unreachableSince ??= Date.now();
      startBootstrap('fallback');
      if (endsAttempt) scheduleRetry();
    }
    endResolveSpanIfSettled();
  }

  return {
    settled,
    /** The last PostHog answer was a failure (blocked, timed out, offline). */
    unreachable,

    receiveRemote,

    /**
     * Attach the PostHog client right after `init`, before its first
     * `/flags` request can answer: PostHog replays an earlier answer to a
     * late subscriber without saying it failed. A client without cached
     * flags (a new user, device or cleared storage) reads the backend in
     * parallel.
     */
    connect(next: FlagClient) {
      const startedAt = Date.now();
      client = next;
      setHadCache((next.featureFlags?.getFlags().length ?? 0) > 0);
      resolveSpan = Telemetry.span('feature_flags.resolve', {
        startTime: startedAt,
        attributes: { 'flags.had_cache': hadCache() },
      });
      startLoadSpan(startedAt);
      const unsubscribe = next.onFeatureFlags((_flags, _variants, context) => {
        // Flags swap flagged subtrees, often to lazy views. A transition
        // keeps the painted UI until the new one is ready instead of flashing
        // Suspense fallbacks in between.
        fireAndForget(
          startTransition(() => receiveRemote(context?.errorsLoading === true)),
          'feature-flags'
        );
      });
      if (!hadCache()) startBootstrap('cold');
      return () => {
        unsubscribe();
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        for (const span of [loadSpan, resolveSpan]) {
          span?.setAttr('flags.outcome', 'cancelled');
          span?.end();
        }
        loadSpan = undefined;
        resolveSpan = undefined;
        client = undefined;
      };
    },

    /**
     * The signed-in account changed (sign-in, switch, sign-out). Restores
     * that account's last backend flags and reads them again when needed.
     */
    setAccount(next: FlagAccount | undefined) {
      if (next?.userId === account?.userId) return;
      // Signing out leaves nothing of the account's flags on this browser.
      if (account && !next) persistedBootstrap.remove(account.userId);
      accountGeneration += 1;
      account = next;
      // PostHog's answer belongs to whoever it identified then. A different
      // identity (sign-out, a sign-in after an anonymous answer) waits for
      // its own answer, reading the earlier one as a cache meanwhile.
      if (
        remote() === 'ok' &&
        (!next || client?.get_distinct_id?.() !== next.userId)
      ) {
        setRemote('stale');
      }
      const answered = remote() === 'ok';
      if (next && answered) persistedBootstrap.remove(next.userId);
      batch(() => {
        setBootstrap(undefined);
        setBootstrapStatus('idle');
        setPersisted(
          next && !answered ? readPersisted(next.userId) : undefined
        );
      });
      if (!next || answered) return;
      if (!hadCache() || remote() === 'unreachable') {
        startBootstrap(remote() === 'unreachable' ? 'fallback' : 'cold');
      }
      endResolveSpanIfSettled();
    },

    /**
     * Resolves once PostHog or the backend has answered this session, both
     * have failed, or `timeoutMs` passes, whichever is first. For one-time
     * decisions that should wait for a fresh answer over a cached one.
     */
    whenAnswered(timeoutMs: number): Promise<void> {
      return new Promise((resolve) => {
        createRoot((dispose) => {
          const finish = () => {
            clearTimeout(timer);
            dispose();
            resolve();
          };
          const timer = setTimeout(finish, timeoutMs);
          createEffect(() => {
            const bootstrapDone =
              bootstrapStatus() === 'ok' || bootstrapStatus() === 'failed';
            if (
              remote() === 'ok' ||
              bootstrapStatus() === 'ok' ||
              (remote() === 'unreachable' && bootstrapDone)
            ) {
              finish();
            }
          });
        });
      });
    },

    /**
     * Whether a flag is on. `readPostHog` reads PostHog's current value: its
     * answer this session, or its cache before that. Tracks every source.
     */
    resolve(
      key: string,
      readPostHog: () => boolean | undefined
    ): { enabled: boolean; source: FlagSource } | undefined {
      revision();
      const source = activeSource();
      if (source === undefined) {
        // A reader outside the provider (tests, early helpers) still sees
        // whatever PostHog holds.
        const value = readPostHog();
        return value === undefined
          ? undefined
          : { enabled: value, source: 'cache' };
      }
      if (source === 'remote' || source === 'cache') {
        const value = readPostHog();
        return value === undefined ? undefined : { enabled: value, source };
      }
      const values = source === 'bootstrap' ? bootstrap() : persisted();
      return { enabled: isOn(values?.[key]), source };
    },
  };
}

export type FlagStore = ReturnType<typeof createFlagStore>;

/** The app's flag store; `PosthogProvider` connects it to PostHog. */
export const flagStore = createFlagStore();

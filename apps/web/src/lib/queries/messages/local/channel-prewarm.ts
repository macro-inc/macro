import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import type { CacheHost } from '@graphql-cache/index';
import { MAX_EVICTED_CHANNELS } from '@graphql-cache/index';
import { type Span, Telemetry } from '@macro-inc/observability';
import { ChannelListSoupDocument } from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import { makeGraphqlSoupInput } from '../../soup/graphql/ast';
import type { SoupAstItemsQueryArgs } from '../../soup/items';
import {
  type ChannelPageHost,
  type ChannelTouches,
  type FetchChannelServerPage,
  loadChannelPage,
} from './channel-pages';
import type { ChannelSyncRuntime } from './channel-sync-runtime';

/** Unread channels kept ready on the device, most recently active first. */
export const PREWARM_UNREAD_CHANNELS = 40;
/** Recently opened channels kept ready on the device, besides unread ones. */
export const PREWARM_RECENT_CHANNELS = 20;
/** The page a channel opens with: only the latest is kept ready. */
export const PREWARM_PAGE_SIZE = 50;
/**
 * The pause between two channels. The cache worker checkpoints its write-ahead
 * log after 100ms without writes (`IDLE_CHECKPOINT_QUIET_MS`); a pause shorter
 * than that lets a whole pass share one checkpoint instead of one per channel.
 */
export const PREWARM_PACE_MS = 40;
/** How long the person must leave the app alone before the next channel. */
export const PREWARM_QUIET_MS = 3_000;
/** The longest `requestIdleCallback` may hold the next channel back. */
const IDLE_TIMEOUT_MS = 5_000;
/** Channels neither opened nor kept ready for this long leave the device. */
export const CHANNEL_EVICTION_AGE_MS = 30 * 86_400_000;
/**
 * The most passes one round asks for. A pass ends after about 200 messages, at
 * one channel or a few, so people's own writes get in between.
 */
const MAX_EVICTION_PASSES = 200;

const JOINED = { channelIsParticipant: [true] };

const UNREAD_CHANNELS: SoupAstItemsQueryArgs = {
  params: { limit: PREWARM_UNREAD_CHANNELS, sort_method: 'updated_at' },
  body: compileToAst(
    queryStateFrom(
      defineQueryFilters({ include: { ...JOINED, channelSeen: false } })
    )
  ),
};

const RECENT_CHANNELS: SoupAstItemsQueryArgs = {
  params: { limit: PREWARM_RECENT_CHANNELS, sort_method: 'viewed_at' },
  body: compileToAst(queryStateFrom(defineQueryFilters({ include: JOINED }))),
};

export type FetchChannelListIds = (
  list: SoupAstItemsQueryArgs
) => Promise<string[]>;

/**
 * One page of a channel list, filtered, ordered and cut off by the server.
 * Always asked of the server: the list the device kept is as an earlier page
 * left it, without the channels that became unread while the app was closed.
 */
const fetchChannelListIds: FetchChannelListIds = async (list) => {
  const result = await getGraphqlSoupClient()
    .query(
      ChannelListSoupDocument,
      { input: makeGraphqlSoupInput(list) },
      { requestPolicy: 'network-only' }
    )
    .toPromise();
  if (result.error) throw result.error;
  return (result.data?.user.soup.items ?? []).flatMap((item) =>
    item.__typename === 'GraphqlSoupChannel' ? [item.id] : []
  );
};

/**
 * The channels to keep ready, in warming order: up to forty unread ones, most
 * recently active first, then the twenty most recently opened. Each request
 * starts in `span`, the second after an await too.
 */
export async function loadPrewarmChannelIds(
  span: Pick<Span, 'run'>,
  fetchIds: FetchChannelListIds = fetchChannelListIds
): Promise<string[]> {
  const unread = await span.run(() => fetchIds(UNREAD_CHANNELS));
  const recent = await span.run(() => fetchIds(RECENT_CHANNELS));
  return [...new Set([...unread, ...recent])];
}

export type ChannelPrewarmHost = ChannelPageHost &
  Pick<CacheHost, 'channelTimelineEvict'>;

export interface ChannelPrewarmDeps {
  host: ChannelPrewarmHost;
  runtime: Pick<
    ChannelSyncRuntime,
    'epoch' | 'noteServerRead' | 'ensureCurrent'
  >;
  touches: ChannelTouches;
  /** The channels to keep ready, in warming order, asked within `span`. */
  listChannels: (span: Span) => Promise<string[]>;
  /** Completes once the next channel may start: the person is away and the browser idle. */
  idle: Effect.Effect<void>;
  online: () => boolean;
  fetchPage?: FetchChannelServerPage;
  now?: () => number;
  paceMs?: number;
}

export interface ChannelPrewarmOutcome {
  /** Latest pages fetched because the device did not hold them. */
  fetched: number;
  /** Channels the device held, checked against the server's sequence. */
  held: number;
  failed: number;
  /** The device cannot serve channels; nothing more to do on this host. */
  unavailable: boolean;
}

/**
 * A write the cache engine has been sent. Nothing recalls it, so a pass that is
 * replaced ends only once it has: the next pass must not queue another behind it.
 */
const engineWrite = <T>(run: () => Promise<T>): Effect.Effect<T, unknown> =>
  Effect.uninterruptible(
    Effect.tryPromise({ try: run, catch: (error) => error })
  );

type ChannelResult = 'fetched' | 'held' | 'failed' | 'unsupported';

/**
 * Keeps one channel's latest page on the device: fetches it when missing and
 * otherwise catches it up, which asks the server nothing while the socket has
 * kept it current. Bookkeeping matches what an opened channel records, so
 * opening it later finds it current.
 */
const warmChannel = (
  deps: ChannelPrewarmDeps,
  parent: Span,
  channelId: string
): Effect.Effect<ChannelResult> =>
  Effect.gen(function* () {
    const epoch = deps.runtime.epoch();
    const loaded = yield* Effect.tryPromise({
      try: (signal) =>
        parent.run(() =>
          loadChannelPage(
            {
              host: deps.host,
              touches: deps.touches,
              fetchPage: deps.fetchPage,
              now: deps.now,
            },
            { channelId, limit: PREWARM_PAGE_SIZE },
            signal
          )
        ),
      catch: (error) => error,
    });
    if (loaded === 'unsupported') return 'unsupported' as const;
    const stored = yield* engineWrite(() => loaded.stored);
    // Not stored: the next pass reads it again, under the new session.
    if (stored === 'session-changed') return 'failed' as const;
    if (loaded.source === 'server') {
      deps.runtime.noteServerRead(channelId, {
        readSeq: loaded.readSeq,
        epoch,
      });
      return 'fetched' as const;
    }
    // After awaits: the catch-up joins the pass's trace again. One a new
    // connection ended is asked once more: a reconnect catches up only the
    // channels on screen. Ended twice, the next pass warms it.
    for (let ask = 0; ask < 2; ask += 1) {
      const caughtUp = yield* Effect.tryPromise({
        try: () => parent.run(() => deps.runtime.ensureCurrent(channelId)),
        catch: (error) => error,
      });
      if (caughtUp !== 'skipped') return 'held' as const;
    }
    return 'failed' as const;
  }).pipe(
    Effect.tapError((error) =>
      Effect.sync(() => Telemetry.error(error, { surface: 'channel-prewarm' }))
    ),
    Effect.orElseSucceed(() => 'failed' as const)
  );

/**
 * One pass: lists the channels to keep ready and warms them one at a time,
 * each once the person leaves the app alone, with a short pause between
 * them. Offline, or once the device turns out unable to hold channels, the
 * pass stops; the next one starts over.
 */
export const prewarmChannels = (
  deps: ChannelPrewarmDeps
): Effect.Effect<ChannelPrewarmOutcome, unknown> =>
  Effect.gen(function* () {
    const span = Telemetry.span('channel.prewarm');
    yield* Effect.addFinalizer(() => Effect.sync(() => span.end()));
    const outcome: ChannelPrewarmOutcome = {
      fetched: 0,
      held: 0,
      failed: 0,
      unavailable: false,
    };
    const channelIds = yield* Effect.tryPromise({
      try: () => deps.listChannels(span),
      catch: (error) => error,
    }).pipe(Effect.tapError((error) => Effect.sync(() => span.error(error))));
    span.setAttr('prewarm.channels', channelIds.length);
    for (const [index, channelId] of channelIds.entries()) {
      if (index > 0) yield* Effect.sleep(deps.paceMs ?? PREWARM_PACE_MS);
      yield* deps.idle;
      if (!deps.online()) break;
      const result = yield* warmChannel(deps, span, channelId);
      if (result === 'unsupported') {
        outcome.unavailable = true;
        break;
      }
      outcome[result] += 1;
    }
    span.setAttr('prewarm.fetched', outcome.fetched);
    span.setAttr('prewarm.held', outcome.held);
    span.setAttr('prewarm.failed', outcome.failed);
    span.setAttr('prewarm.unavailable', outcome.unavailable);
    return outcome;
  }).pipe(Effect.scoped);

/**
 * Removes channels not opened or kept ready for thirty days, with their
 * messages; every tab hears which are gone. Each pass holds the cache engine,
 * so it starts as the next channel to warm would. Completes with the number of
 * channels removed.
 */
export const evictIdleChannels = (
  deps: Pick<ChannelPrewarmDeps, 'idle' | 'now' | 'paceMs'> & {
    host: Pick<CacheHost, 'channelTimelineEvict'>;
  }
): Effect.Effect<number, unknown> =>
  Effect.gen(function* () {
    const { host } = deps;
    const span = Telemetry.span('channel.evict_idle');
    let evicted = 0;
    let passes = 0;
    let more = true;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        span.setAttr('evict.channels', evicted);
        span.setAttr('evict.passes', passes);
        span.setAttr('evict.more', more);
        span.end();
      })
    );
    const touchedBeforeMs = (deps.now ?? Date.now)() - CHANNEL_EVICTION_AGE_MS;
    while (more && passes < MAX_EVICTION_PASSES) {
      yield* Effect.sleep(deps.paceMs ?? PREWARM_PACE_MS);
      yield* deps.idle;
      const result = yield* engineWrite(() =>
        span.run(() =>
          host.channelTimelineEvict({
            touchedBeforeMs,
            maxChannels: MAX_EVICTED_CHANNELS,
          })
        )
      );
      passes += 1;
      more = result.kind !== 'unsupported' && result.hasMore;
      if (result.kind !== 'unsupported') evicted += result.channelIds.length;
    }
    return evicted;
  }).pipe(Effect.scoped);

/** A pass followed by eviction, unless the device cannot hold channels. */
export const runChannelPrewarmPass = (
  deps: ChannelPrewarmDeps
): Effect.Effect<ChannelPrewarmOutcome, unknown> =>
  Effect.gen(function* () {
    const outcome = yield* prewarmChannels(deps);
    if (!outcome.unavailable) yield* evictIdleChannels(deps);
    return outcome;
  });

export interface ChannelPrewarm {
  /** Starts a pass after `delayMs`, interrupting one still running. */
  run(delayMs?: number): void;
  /** Interrupts the running pass and stops for good. */
  dispose(): void;
}

/**
 * Runs passes on demand, one at a time, each in its own fiber: a new request
 * interrupts the pass in flight and starts once that one has stopped, which a
 * write it already sent the engine holds back. Disposing interrupts it too, as
 * when this tab stops leading or the host goes.
 */
export function createChannelPrewarm(deps: ChannelPrewarmDeps): ChannelPrewarm {
  let fiber: Fiber.Fiber<unknown, unknown> | undefined;
  let disposed = false;
  // Not interrupted by the next pass in turn, which waits for this wait.
  const stopped = (pass: typeof fiber): Effect.Effect<void> =>
    pass ? Effect.uninterruptible(Fiber.interrupt(pass)) : Effect.void;
  return {
    run(delayMs = 0) {
      if (disposed) return;
      fiber = Effect.runFork(
        stopped(fiber).pipe(
          Effect.andThen(Effect.sleep(delayMs)),
          Effect.andThen(runChannelPrewarmPass(deps)),
          Effect.catchCause((cause) =>
            Effect.sync(() => {
              // A pass interrupted by the next one, or by losing the lead, did not fail.
              if (Cause.hasInterruptsOnly(cause)) return;
              Telemetry.error(cause, { surface: 'channel-prewarm' });
            })
          )
        )
      );
    },
    dispose() {
      disposed = true;
      Effect.runFork(stopped(fiber));
      fiber = undefined;
    },
  };
}

const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

export interface UserQuiet {
  /** Completes once the person has left the app alone and the browser is idle. */
  idle: Effect.Effect<void>;
  dispose(): void;
}

/** Notes the person's input, so background work can wait until they pause. */
export function createUserQuiet(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
  quietMs = PREWARM_QUIET_MS
): UserQuiet {
  let lastInputAt = 0;
  const noteInput = () => {
    lastInputAt = Date.now();
  };
  for (const event of INPUT_EVENTS) {
    target.addEventListener(event, noteInput, { capture: true, passive: true });
  }
  const browserIdle = Effect.callback<void>((resume) => {
    if (typeof requestIdleCallback === 'undefined') {
      resume(Effect.void);
      return;
    }
    const handle = requestIdleCallback(() => resume(Effect.void), {
      timeout: IDLE_TIMEOUT_MS,
    });
    return Effect.sync(() => cancelIdleCallback(handle));
  });
  const quietFor = () => Date.now() - lastInputAt;
  const idle: Effect.Effect<void> = Effect.suspend(() => {
    if (quietFor() < quietMs) {
      return Effect.andThen(Effect.sleep(quietMs - quietFor()), idle);
    }
    return Effect.andThen(
      browserIdle,
      // The person may be back by the time the browser is idle.
      Effect.suspend(() => (quietFor() < quietMs ? idle : Effect.void))
    );
  });
  return {
    idle,
    dispose() {
      for (const event of INPUT_EVENTS) {
        target.removeEventListener(event, noteInput, { capture: true });
      }
    },
  };
}

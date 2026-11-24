/**
 * How a property catalog write is sent and settled: the checks before it is
 * sent (online, login, session, a cache holding older writes), and the wait
 * for a write the cache queued, by its transaction or, when its enqueue lost
 * its reply, by the id it was queued under. The writes themselves are in
 * `writes.ts`.
 */

import { TRACE_PARENT_CONTEXT_KEY } from '@app/lib/urql-solid/trace-parent-exchange';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  type CacheHost,
  optimisticMutationDispositionOf,
} from '@graphql-cache/index';
import { isAdmittedEnqueueUncertainError } from '@graphql-cache/protocol';
import { Telemetry } from '@macro-inc/observability';
import {
  getGraphqlSoupCacheHost,
  graphqlDraftQueueBlocked,
  graphqlSoupSessionActive,
} from '@service-storage/graphql-soup';
import { onlineManager } from '@tanstack/solid-query';
import type {
  AnyVariables,
  OperationContext,
  OperationResult,
} from '@urql/core';
import { createEffect, createRoot } from 'solid-js';
import { queryAccountSession } from '../../auth/account-scope';
import { observePropertyMutationSettlements } from '../graphql/mutation-settlements';
import { CatalogMutationError, isCatalogErrorCode } from './errors';

/** The code REST's status class carried, for a refusal made before GraphQL ran. */
function httpStatusCode(status: number | undefined): string | undefined {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  return undefined;
}

export function errorOf(result: OperationResult): CatalogMutationError {
  const [first] = result.error?.graphQLErrors ?? [];
  const code = first?.extensions?.code;
  const reason = first?.extensions?.reason;
  const response = result.error?.response as Response | undefined;
  return new CatalogMutationError(
    first?.message ?? result.error?.message ?? 'Property catalog write failed',
    typeof code === 'string' ? code : httpStatusCode(response?.status),
    typeof reason === 'string' ? reason : undefined
  );
}

/**
 * Resolves once the app is online (`onlineManager`, the native network path on
 * iOS and Android), as TanStack held a mutation started offline until then.
 */
export function whenOnline(signal?: AbortSignal): Promise<void> {
  if (onlineManager.isOnline()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = onlineManager.subscribe((online) => {
      if (!online) return;
      unsubscribe();
      resolve();
    });
    // A caller that stopped waiting leaves no listener behind.
    signal?.addEventListener('abort', unsubscribe, { once: true });
  });
}

type Settlements = ReturnType<typeof observePropertyMutationSettlements>;

type SettleOptions = {
  waitForCommit: boolean;
  serverAnswered: boolean;
  onLateFailure?: (error: Error) => void;
  /** Runs once the server has the write, whether it went at once or queued. */
  onCommit?: () => void;
  /** The login session the write's flow began in; the session now when omitted. */
  session?: number;
  /**
   * The id the cache queues the write under, for one it predicts: a write
   * whose enqueue lost its reply is found by it.
   */
  uuid?: string;
};

export const accountChanged = (when: string) =>
  new CatalogMutationError(
    `Another login took over ${when}`,
    'ACCOUNT_CHANGED'
  );

const signedOut = (when: string) =>
  new CatalogMutationError(`The session ended ${when}`, 'SIGNED_OUT');

/** A write refused while the cache holds older writes it cannot send yet. */
export const writesPaused = () =>
  new CatalogMutationError(
    'Saving is paused while earlier changes wait to sync. Try again in a moment.',
    'WRITES_PAUSED'
  );

/** Whether a write's outcome is no longer this page's to report. */
const belongsElsewhere = (session: number) =>
  queryAccountSession() !== session || !graphqlSoupSessionActive();

/** What a write's wait depends on: its login, and the cache holding it. */
type WaitScope = {
  session: number;
  /** The cache the write is queued on; omitted when none holds it. */
  host?: CacheHost;
  when: string;
};

/**
 * Whether a host can no longer report a write: retiring it silences its
 * listeners and disables it. A host paused through an outage is disabled too,
 * but keeps its queue and listeners and serves again as itself, so it still
 * reports. Hosts that cannot pause have no `paused`.
 */
const isHostGone = (host: CacheHost): boolean =>
  host.disabled === true && !('paused' in host && host.paused === true);

/**
 * Why a write's wait ended before its work did, if it did: another login took
 * over, the session ended (a sign-out, which then wipes the cache), or the
 * cache holding the write stopped (retired, failed or replaced), which will
 * never report it. A cache that is paused, or hidden while it resumes, has
 * not stopped.
 */
function waitEnded({
  session,
  host,
  when,
}: WaitScope): CatalogMutationError | undefined {
  if (queryAccountSession() !== session) return accountChanged(when);
  if (!graphqlSoupSessionActive()) return signedOut(when);
  // Read for its changes: each retirement, pause and resume is announced there.
  getGraphqlSoupCacheHost();
  if (host && isHostGone(host))
    return new CatalogMutationError(
      `The cache stopped ${when}`,
      'CACHE_STOPPED'
    );
  return undefined;
}

/**
 * Waits for `work`, or rejects once the wait ended (`waitEnded`), aborting
 * `work`'s signal. An outcome that arrives as the login changes or the
 * session ends belongs to the old login; one the cache reported before it
 * stopped still stands.
 */
async function whileWaitHolds<T>(
  scope: WaitScope,
  work: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const ended = () => waitEnded(scope);
  const loginEnded = () => {
    if (queryAccountSession() !== scope.session)
      return accountChanged(scope.when);
    if (!graphqlSoupSessionActive()) return signedOut(scope.when);
    return undefined;
  };
  const abort = new AbortController();
  let stop = () => {};
  const stopped = new Promise<never>((_, reject) => {
    createRoot((dispose) => {
      stop = dispose;
      createEffect(() => {
        const reason = ended();
        if (reason) reject(reason);
      });
    });
  });
  try {
    const value = await Promise.race([work(abort.signal), stopped]);
    const reason = loginEnded();
    if (reason) throw reason;
    return value;
  } catch (error: unknown) {
    throw loginEnded() ?? error;
  } finally {
    stop();
    abort.abort();
  }
}

/**
 * How long a write the queue no longer holds waits for its settlement. A host
 * may deliver a settlement after the queue answer that followed it.
 */
const SETTLEMENT_GRACE_MS = 500;

/**
 * Waits for a write the cache may have queued although its enqueue lost its
 * reply. Its settlement decides; a queue that answers without it, with no
 * settlement of it soon after, never took it.
 */
async function commitOfUncertain(
  settlements: Settlements,
  host: CacheHost | undefined,
  uuid: string
): Promise<void> {
  const settled = settlements.waitForMutation(uuid);
  const queued = (async () => {
    try {
      const queue = await host?.inspectMutations?.();
      return queue?.some((mutation) => mutation.uuid === uuid);
    } catch (error: unknown) {
      // Unknown: its settlement still decides.
      console.error('Inspecting the property write queue failed', error);
      return undefined;
    }
  })();
  const reported = (async () => {
    try {
      await settled;
    } catch {
      // The caller reads the failure from `settled`.
    }
    return 'settled' as const;
  })();
  const graceEnded = () =>
    new Promise<'absent'>((resolve) => {
      setTimeout(() => resolve('absent'), SETTLEMENT_GRACE_MS);
    });
  const first = await Promise.race([reported, queued]);
  if (
    first === false &&
    !settlements.reported(uuid) &&
    (await Promise.race([reported, graceEnded()])) === 'absent'
  ) {
    throw new CatalogMutationError(
      'The change was not saved. Try again.',
      'NOT_SAVED'
    );
  }
  return settled;
}

/**
 * How to wait for the commit of a write the cache took, if it took it: a
 * queued one by its transaction, one whose enqueue lost its reply by its id.
 */
function commitOf(
  settlements: Settlements,
  host: CacheHost | undefined,
  result: OperationResult,
  uuid: string | undefined
): (() => Promise<void>) | undefined {
  const disposition = optimisticMutationDispositionOf(result);
  if (disposition?.kind === 'queued')
    return () => settlements.waitForCommit(disposition.transactionId);
  if (
    uuid !== undefined &&
    isAdmittedEnqueueUncertainError(result.error?.networkError)
  )
    return () => commitOfUncertain(settlements, host, uuid);
  return undefined;
}

/** Waits for a queued write's commit in the background. */
async function observeCommit(
  settlements: Settlements,
  committed: () => Promise<void>,
  scope: WaitScope,
  options: SettleOptions
): Promise<void> {
  let failure: Error | undefined;
  try {
    await whileWaitHolds(scope, committed);
  } catch (error: unknown) {
    failure = error instanceof Error ? error : new Error(String(error));
  } finally {
    settlements.dispose();
  }
  // The old login's write is not this page's to report, nor a write a
  // sign-out wiped. Checked here, right before the callbacks, since a login
  // can change after the wait ends.
  if (
    belongsElsewhere(scope.session) ||
    isCatalogErrorCode(failure, 'ACCOUNT_CHANGED') ||
    isCatalogErrorCode(failure, 'SIGNED_OUT')
  )
    return;
  if (!failure) {
    options.onCommit?.();
    return;
  }
  console.error('Queued property catalog write failed', failure);
  options.onLateFailure?.(failure);
}

type Settled<TData> =
  | { kind: 'committed'; data: TData | undefined; waited?: true }
  | { kind: 'queued' };

/**
 * Submits one write and reads its outcome. A queued write (offline, or behind
 * an older write) either waits for its commit, or resolves at once and reports
 * a later refusal through `onLateFailure`; the cache has rolled it back by then.
 * A write that goes straight to the server (`serverAnswered`) waits until the
 * app is online before it is sent, in the trace it was started in, and is
 * dropped if another login took over the page meanwhile, or since the
 * `session` its flow began in, or the session ended. `send` reads the
 * client and cache when it runs. A write is refused while the cache holds
 * older writes it cannot send yet.
 */
export async function settle<TData, TVariables extends AnyVariables>(
  send: (
    context: Partial<OperationContext>
  ) => Promise<OperationResult<TData, TVariables>>,
  options: SettleOptions
): Promise<Settled<TData>> {
  // Context does not survive an await in the browser, so a write the server
  // answers carries it to its request (see trace-parent-exchange). The cache
  // queue sends the others inside its own attempt span.
  const trace = Telemetry.captureContext();
  const context: Partial<OperationContext> = options.serverAnswered
    ? { [TRACE_PARENT_CONTEXT_KEY]: trace }
    : {};
  const session = options.session ?? queryAccountSession();
  if (options.serverAnswered && !onlineManager.isOnline())
    await whileWaitHolds(
      { session, when: 'before the write was sent' },
      whenOnline
    );
  if (queryAccountSession() !== session)
    throw new CatalogMutationError(
      'Another login took over before the write was sent',
      'ACCOUNT_CHANGED'
    );
  if (!graphqlSoupSessionActive()) throw signedOut('before the write was sent');
  // A cache paused through an outage, or resuming but not handed out yet,
  // still holds older writes; this one would overtake them.
  if (graphqlDraftQueueBlocked()) throw writesPaused();
  const host = getGraphqlSoupCacheHost();
  const settlements = observePropertyMutationSettlements(host);
  const saving: WaitScope = {
    session,
    host,
    when: 'before the write was saved',
  };
  let observing = false;
  try {
    const result = await trace.run(() => send(context));
    // An answer that arrives after sign-out or a login change is not this
    // page's to report.
    if (queryAccountSession() !== session)
      throw accountChanged('before the write was answered');
    if (!graphqlSoupSessionActive())
      throw signedOut('before the write was answered');
    const committed = commitOf(settlements, host, result, options.uuid);
    if (committed) {
      if (options.waitForCommit) {
        await whileWaitHolds(saving, committed);
        // A login can change after the wait ends.
        if (queryAccountSession() !== session)
          throw accountChanged(saving.when);
        options.onCommit?.();
        return { kind: 'committed', data: undefined, waited: true };
      }
      observing = true;
      fireAndForget(
        observeCommit(settlements, committed, saving, options),
        'property-catalog'
      );
      return { kind: 'queued' };
    }
    if (result.error) throw errorOf(result);
    const disposition = optimisticMutationDispositionOf(result);
    if (disposition?.kind === 'permanently-failed') {
      throw new CatalogMutationError(disposition.error.message);
    }
    options.onCommit?.();
    return { kind: 'committed', data: result.data };
  } finally {
    if (!observing) settlements.dispose();
  }
}

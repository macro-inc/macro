import { cacheRequestStamp } from '../host/read-availability';
import {
  ADMITTED_ENQUEUE_UNCERTAIN_ERROR_CODE,
  CACHE_SUPERSEDED_ERROR_CODE,
  type CachePush,
  type CacheRequest,
  type CacheResponse,
  type CacheResponseErrorCode,
  isTypedSearch,
  OWNER_EPOCH_LOST_ERROR_CODE,
  OWNER_LOCK_UNAVAILABLE_ERROR_CODE,
  WRITE_NOT_ADMITTED_ERROR_CODE,
} from '../protocol';
import type { CacheUnavailableReason } from '../telemetry';
import {
  CacheChangeBatch,
  type CoalescedCacheChange,
} from './cache-change-batch';
import type {
  CacheQueueState,
  DatabaseAction,
  DatabaseActionProof,
  EngineOpenOutcome,
  EngineStartupPhase,
  OwnerEpoch,
  RouteId,
} from './coordinator-protocol';

/** Why an owner lock stayed with another context. */
export type OwnerLockUnavailableReason = Extract<
  CacheUnavailableReason,
  'owner-lock-timeout' | 'no-takeover-channel' | 'holder-kept'
>;

export type CoordinatorState =
  | { kind: 'waiting-for-tab'; nextDatabaseAction: DatabaseAction }
  | { kind: 'parked'; nextDatabaseAction: DatabaseAction }
  | {
      kind: 'activating';
      tabId: string;
      ownerEpoch: OwnerEpoch;
      databaseAction: DatabaseAction;
      phase: EngineStartupPhase;
    }
  | { kind: 'active'; tabId: string; ownerEpoch: OwnerEpoch }
  | { kind: 'draining'; tabId: string; ownerEpoch: OwnerEpoch }
  | {
      kind: 'resetting-after-loss';
      previousTabId: string;
      previousEpoch: OwnerEpoch;
      nextEpoch: OwnerEpoch;
      databaseAction: DatabaseAction;
      reason: string;
    };

/** Why nothing serves the cache. Opening the database is tried on. */
type CacheOutage = {
  reason: string;
  unavailableReason: CacheUnavailableReason;
};

export type CoordinatorSnapshot = {
  scope: string;
  state: CoordinatorState;
  tabIds: string[];
  ownerEpoch: OwnerEpoch;
  queuedRequestCount: number;
  inFlightRequestCount: number;
  staleMessageDrops: number;
  protocolViolations: number;
  activeOwnerCount: 0 | 1;
};

type QueuedRequest = {
  tabId: string;
  request: CacheRequest;
  /** On the clock of whoever calls `request` and `refuseQueuedWrites`. */
  queuedAt: number;
};

type InFlightRequest = QueuedRequest & {
  routeId: RouteId;
  ownerEpoch: OwnerEpoch;
};

export type CoordinatorAction =
  | {
      kind: 'elect-owner';
      tabId: string;
      ownerEpoch: OwnerEpoch;
      databaseAction: DatabaseAction;
    }
  | {
      kind: 'route-request';
      ownerTabId: string;
      requesterTabId: string;
      ownerEpoch: OwnerEpoch;
      routeId: RouteId;
      request: CacheRequest;
    }
  | { kind: 'deliver-response'; tabId: string; response: CacheResponse }
  | { kind: 'broadcast-push'; push: CachePush; coalescedCount?: number }
  | {
      kind: 'reject-request';
      tabId: string;
      requestId: number;
      error: string;
      errorCode?: CacheResponseErrorCode;
    }
  | {
      kind: 'drain-owner';
      tabId: string;
      ownerEpoch: OwnerEpoch;
      handoff?: true;
    }
  | {
      kind: 'release-owner';
      tabId: string;
      ownerEpoch: OwnerEpoch;
      reason: string;
    }
  | { kind: 'handoff-pending'; ownerEpoch: OwnerEpoch }
  | { kind: 'close-engine-route'; tabId: string; ownerEpoch: OwnerEpoch }
  | { kind: 'drop-tab'; tabId: string }
  | { kind: 'retire-tab'; tabId: string; ownerEpoch: OwnerEpoch }
  | { kind: 'schedule-reset-activation' }
  /** Calls `settlementsOverdue` after `ms` unless the handover went ahead. */
  | { kind: 'await-settlements'; ms: number; claims: number }
  /** The wait for claimed heads is over: they settled, or `unsettled` did not. */
  | { kind: 'settlement-wait-ended'; unsettled: number }
  /** Calls `claimLeaseEnded` after `ms`, when another page may claim the head. */
  | {
      kind: 'claim-lease';
      transactionId: string;
      leaseGeneration: string | undefined;
      ms: number;
    }
  | {
      kind: 'broadcast-cache-unavailable';
      reason: string;
      unavailableReason: CacheUnavailableReason;
    }
  | { kind: 'broadcast-cache-superseded'; reason: string }
  | {
      kind: 'notify-cache-unavailable';
      tabId: string;
      reason: string;
      unavailableReason: CacheUnavailableReason;
    }
  | { kind: 'notify-cache-superseded'; tabId: string; reason: string }
  | {
      kind: 'broadcast-engine-replaced';
      ownerEpoch: OwnerEpoch;
      openOutcome: EngineOpenOutcome;
      queue: CacheQueueState;
    }
  | {
      kind: 'drop-stale-engine-message';
      ownerEpoch: OwnerEpoch;
      routeId?: RouteId;
      reason: 'stale-epoch' | 'unknown-route' | 'inactive-engine';
    }
  | { kind: 'protocol-violation'; error: string };

export type EngineReady = {
  /** Its page may be shown again before it hands over. */
  hiddenBriefly?: boolean;
  tabId: string;
  ownerEpoch: OwnerEpoch;
  ownerLockName: string;
  expectedOwnerLockName: string;
  ownerLockHeld: true;
  databaseActionProof: DatabaseActionProof;
  openOutcome: EngineOpenOutcome;
  queue: CacheQueueState;
};

const proofFor = (outcome: EngineOpenOutcome): DatabaseActionProof =>
  outcome.startsWith('reset-') ? 'wiped-before-open' : 'opened-existing';

/** Only `opening-database` follows the storage grant; earlier phases, including
 * waiting for the owner lock, cannot have changed OPFS. */
export const startupPhaseMayTouchStorage = (
  phase: EngineStartupPhase
): boolean => phase === 'opening-database';

const OWNER_LOCK_UNAVAILABLE_REASON =
  'cache database owner lock is held by another context, such as another app version';
const STORAGE_BUSY_REASON =
  'cache database files are still open in another context, such as a closing tab';
const SUPERSEDED_REASON =
  'a newer version of the app took over the local cache';

/**
 * How long a newer build waits for this build's pages to settle a queue head
 * they claimed, counted from the takeover and again from each claim made
 * during the wait. A queued request gives up after `QUEUE_REQUEST_TIMEOUT_MS`
 * (60 s) and its page then settles it as a retry; this adds time for that
 * settlement to reach the engine. Past it the handover goes ahead, and a page
 * that settles later is refused: its server answer is not kept, and another
 * page sends the mutation again.
 */
export const SETTLEMENT_WAIT_MS = 70_000;
/** The longest a newer build waits however many claims the wait sees. */
export const SETTLEMENT_WAIT_LIMIT_MS = 2 * SETTLEMENT_WAIT_MS;

/** A queue head a page claimed, and the lease that may settle it. */
type QueueClaim = { tabId: string; leaseGeneration: string | undefined };

/** The queue head a response hands its page, if it hands one. */
function claimedTransaction(
  request: CacheRequest,
  response: CacheResponse
): { transactionId: string; leaseGeneration: string | undefined } | undefined {
  if (!response.ok) return undefined;
  const claimed = (claim: unknown) => {
    const { transactionId, leaseGeneration } = (claim ?? {}) as {
      transactionId?: unknown;
      leaseGeneration?: unknown;
    };
    if (typeof transactionId !== 'string') return undefined;
    return {
      transactionId,
      leaseGeneration:
        typeof leaseGeneration === 'string' ? leaseGeneration : undefined,
    };
  };
  if (request.kind === 'claim-next-mutation') return claimed(response.result);
  if (request.kind === 'enqueue-optimistic-mutation') {
    const result = response.result as {
      initialClaim?: { kind?: unknown; mutation?: unknown };
    } | null;
    const claim = result?.initialClaim;
    return claim?.kind === 'claimed' ? claimed(claim.mutation) : undefined;
  }
  return undefined;
}

/** A request whose answer may hand its page a queue head. */
function mayClaim(request: CacheRequest): boolean {
  return (
    request.kind === 'claim-next-mutation' ||
    request.kind === 'enqueue-optimistic-mutation'
  );
}

/** How long a claim made by this request holds its head. */
function leaseMs(request: CacheRequest): number {
  if (!mayClaim(request)) return 0;
  const { nowMs, leaseExpiresAtMs } = request as {
    nowMs: number;
    leaseExpiresAtMs: number;
  };
  return Math.max(0, leaseExpiresAtMs - nowMs);
}

/** Known outcomes must survive a caller leaving while storage is parked. */
function isMutationSettlement(request: CacheRequest): request is Extract<
  CacheRequest,
  {
    kind:
      | 'commit-optimistic-write'
      | 'rollback-optimistic-write'
      | 'defer-optimistic-write';
  }
> {
  return (
    request.kind === 'commit-optimistic-write' ||
    request.kind === 'rollback-optimistic-write' ||
    request.kind === 'defer-optimistic-write'
  );
}

/** What an outage does not refuse: a handshake, whose answer ends it for the
 * page, and the outcome of a mutation the server already decided. */
function isHeldThroughOutage(request: CacheRequest): boolean {
  return (
    request.kind === 'init' ||
    request.kind === 'current-authority' ||
    isMutationSettlement(request)
  );
}

/** A write its caller can be told was never made. A removal is not: dropping it
 * would leave what it removes. */
function isRefusableWrite(request: CacheRequest): boolean {
  return (
    cacheRequestStamp(request.kind) === 'captured' &&
    !isMutationSettlement(request)
  );
}

/**
 * The order held requests reach a new engine. The engine starts on the first
 * one before it has seen the rest, so a typed search someone is waiting on
 * goes ahead of the reads and hydration replayed around a restart. It never
 * passes a `clear`, whose result it would otherwise predate.
 */
function inEngineArrivalOrder(held: QueuedRequest[]): QueuedRequest[] {
  let clearIndex = held.findIndex((queued) => queued.request.kind === 'clear');
  if (clearIndex === -1) clearIndex = held.length;

  const beforeClear = held.slice(0, clearIndex);
  return [
    ...beforeClear.filter((queued) => isTypedSearch(queued.request)),
    ...beforeClear.filter((queued) => !isTypedSearch(queued.request)),
    ...held.slice(clearIndex),
  ];
}

/** Pure election, epoch, routing, drain, and abrupt-loss state machine. */
export class CoordinatorCore {
  private stateValue: CoordinatorState = {
    kind: 'waiting-for-tab',
    nextDatabaseAction: 'open-existing',
  };
  private readonly tabs: string[] = [];
  private readonly retiringTabs = new Set<string>();
  private readonly visibleTabs = new Set<string>();
  /** Set while nothing can open the database; an engine that does clears it. */
  private outage: CacheOutage | undefined;
  /** Set once a newer app build took the database over; never cleared. */
  private supersededReason: string | undefined;
  /** A newer build asked while this engine may still be changing the files. */
  private supersedePending = false;
  /**
   * Queue heads tabs claimed and have not settled yet, by transaction id. A
   * page's request for one may be on its way to the server.
   */
  private readonly claims = new Map<string, QueueClaim>();
  /**
   * A newer build waits until `claims` settle and no claim is on its way, or
   * the router's deadline. Until then an engine keeps serving this build: one
   * that drains or is lost is replaced, unless its successor would reset the
   * database.
   */
  private awaitingSettlements = false;
  /** Late in the wait no head is claimed, so each claim gets its full wait. */
  private claimsClosed = false;
  /** A hidden owner kept its engine for a claimed head; it drains once settled. */
  private hiddenDrainDeferred = false;
  /** The epoch elected in a hidden tab because no tab was visible. */
  private hiddenElectionEpoch: OwnerEpoch | undefined;
  private readonly queuedRequests: QueuedRequest[] = [];
  private readonly inFlight = new Map<RouteId, InFlightRequest>();
  private readonly cacheChanges = new CacheChangeBatch();
  private currentEpoch = 0;
  private nextRouteId = 1;
  private staleMessageDrops = 0;
  private protocolViolations = 0;

  constructor(readonly scope: string) {
    if (scope.length === 0) throw new Error('scope must not be empty');
  }

  get state(): CoordinatorState {
    return { ...this.stateValue };
  }

  snapshot(): CoordinatorSnapshot {
    return {
      scope: this.scope,
      state: this.state,
      tabIds: [...this.tabs],
      ownerEpoch: this.currentEpoch,
      queuedRequestCount: this.queuedRequests.length,
      inFlightRequestCount: this.inFlight.size,
      staleMessageDrops: this.staleMessageDrops,
      protocolViolations: this.protocolViolations,
      activeOwnerCount: this.stateValue.kind === 'active' ? 1 : 0,
    };
  }

  /** Visibility of eligible consumers, not merely the page owning an engine. */
  get hasVisibleTab(): boolean {
    return this.eligibleTabs().some((tabId) => this.visibleTabs.has(tabId));
  }

  /** A hidden tab starts an engine only so that a head still out has one to
   * settle in, it has not reached storage yet, and another tab could start
   * one instead. Nobody waits to see it, so a startup that stalls, as in a
   * frozen tab, is given up sooner. */
  get startsForSettlement(): boolean {
    const state = this.stateValue;
    return (
      state.kind === 'activating' &&
      !this.hasVisibleTab &&
      !startupPhaseMayTouchStorage(state.phase) &&
      this.unsettled() &&
      this.eligibleTabs().some((tabId) => tabId !== state.tabId)
    );
  }

  /** Whether a newer app build took the database over. */
  get superseded(): boolean {
    return this.supersededReason !== undefined;
  }

  /** Whether a newer app build took the database over, or will once this
   * engine has settled. */
  get handingOver(): boolean {
    return this.supersededReason !== undefined || this.supersedePending;
  }

  registerTab(tabId: string, visible = true): CoordinatorAction[] {
    if (this.tabs.includes(tabId)) return [];
    this.tabs.push(tabId);
    if (visible) this.visibleTabs.add(tabId);
    if (this.supersededReason !== undefined) {
      return [
        {
          kind: 'notify-cache-superseded',
          tabId,
          reason: this.supersededReason,
        },
      ];
    }
    return [
      ...(this.outage
        ? [{ kind: 'notify-cache-unavailable' as const, tabId, ...this.outage }]
        : []),
      ...this.activateOrHandOff(visible),
    ];
  }

  /** A page that just came, or was just shown, is worth a new attempt. */
  private activateOrHandOff(shown: boolean): CoordinatorAction[] {
    const state = this.stateValue;
    if (state.kind === 'parked' || state.kind === 'waiting-for-tab')
      return this.activateNext(state.nextDatabaseAction);
    // An engine started in a hidden tab for a head out may never open, as in
    // a frozen tab. Before it reaches storage, a shown tab starts its own.
    if (
      shown &&
      state.kind === 'activating' &&
      state.ownerEpoch === this.hiddenElectionEpoch &&
      !this.visibleTabs.has(state.tabId) &&
      !startupPhaseMayTouchStorage(state.phase)
    ) {
      const released = this.releaseStartingOwner(
        'a shown tab starts the engine instead'
      );
      // As for any owner that stops: a replacement that would wipe the
      // database a newer build waits for hands it over instead.
      return this.handsOverNow(state.databaseAction)
        ? [...released, ...this.completeSupersede()]
        : [...released, ...this.activateNext(state.databaseAction)];
    }
    if (shown && state.kind === 'resetting-after-loss' && this.outage)
      return this.resumeAfterLoss();
    return this.handoffIfNeeded();
  }

  /**
   * Another visible tab's engine is starting or running, so `tabId` joining
   * now would not take it over: only a hidden owner hands off to a new tab.
   */
  ownedByAnotherVisibleTab(tabId: string): boolean {
    const state = this.stateValue;
    return (
      (state.kind === 'activating' || state.kind === 'active') &&
      state.tabId !== tabId &&
      this.visibleTabs.has(state.tabId)
    );
  }

  setTabVisibility(tabId: string, visible: boolean): CoordinatorAction[] {
    if (!this.tabs.includes(tabId)) return [];
    if (visible) {
      this.visibleTabs.add(tabId);
      // A tab shown while it starts is alive; it keeps its engine.
      const state = this.stateValue;
      if (state.kind === 'activating' && state.tabId === tabId)
        this.hiddenElectionEpoch = undefined;
      // A later hide waits its grace again before the owner drains.
      this.hiddenDrainDeferred = false;
    } else this.visibleTabs.delete(tabId);
    return this.activateOrHandOff(visible);
  }

  request(
    tabId: string,
    request: CacheRequest,
    queuedAt = 0
  ): CoordinatorAction[] {
    if (!this.tabs.includes(tabId)) {
      return [
        this.reject(tabId, request.id, 'requester tab is not registered'),
      ];
    }
    if (this.retiringTabs.has(tabId)) {
      return [this.reject(tabId, request.id, 'requester tab is retiring')];
    }
    if (this.supersededReason !== undefined) {
      return [this.rejectSuperseded(tabId, request.id, this.supersededReason)];
    }
    if (this.outage && !isHeldThroughOutage(request)) {
      return [this.rejectUnavailable(tabId, request.id, this.outage.reason)];
    }

    // Late in the wait an enqueue could claim a head that has no time left to
    // settle. Refused as the database being unavailable, it never reaches an
    // engine and the page sends it as it would with no cache, rather than
    // waiting to time out. Superseded would retire the page's host, and with
    // it the heads it still has out.
    if (
      this.awaitingSettlements &&
      this.claimsClosed &&
      request.kind === 'enqueue-optimistic-mutation'
    )
      return [this.rejectUnavailable(tabId, request.id, SUPERSEDED_REASON)];
    const queued = { tabId, request, queuedAt };
    // A head claimed now would be sent with the engine about to go. The
    // handover refuses the claim as superseded.
    if (this.stateValue.kind !== 'active' || this.holdsForNewerBuild(request)) {
      this.queuedRequests.push(queued);
      // While a newer build waits, a settlement reaches an engine even when
      // every tab is hidden.
      if (
        this.stateValue.kind === 'parked' &&
        this.awaitingSettlements &&
        isMutationSettlement(request)
      )
        return this.activateNext(this.stateValue.nextDatabaseAction);
      return [];
    }
    return [this.route(queued, this.stateValue)];
  }

  /** When the oldest write that may still be refused was queued. */
  get oldestQueuedWriteAt(): number | undefined {
    return this.queuedRequests.find(({ request }) => isRefusableWrite(request))
      ?.queuedAt;
  }

  /** Refuses the writes queued until `queuedUntil`. No engine ever got them. */
  refuseQueuedWrites(queuedUntil: number): CoordinatorAction[] {
    const kept: QueuedRequest[] = [];
    const actions: CoordinatorAction[] = [];
    for (const queued of this.queuedRequests.splice(0)) {
      if (queued.queuedAt <= queuedUntil && isRefusableWrite(queued.request))
        actions.push(
          this.reject(
            queued.tabId,
            queued.request.id,
            'cache write timeout: no owner took it',
            WRITE_NOT_ADMITTED_ERROR_CODE
          )
        );
      else kept.push(queued);
    }
    this.queuedRequests.push(...kept);
    return actions;
  }

  /** The engine loaded its assets and tries to take the database owner lock.
   * Trying grants no storage access. */
  beginOwnerLockWait(tabId: string, ownerEpoch: OwnerEpoch): boolean {
    const state = this.stateValue;
    if (
      state.kind !== 'activating' ||
      state.tabId !== tabId ||
      state.ownerEpoch !== ownerEpoch ||
      state.phase !== 'loading-assets'
    )
      return false;
    this.stateValue = { ...state, phase: 'awaiting-owner-lock' };
    return true;
  }

  /**
   * Another context, usually another deployed build, keeps the database owner
   * lock. Storage was not touched. Every tab runs uncached until a later
   * attempt gets the lock.
   */
  ownerLockUnavailable(
    tabId: string,
    ownerEpoch: OwnerEpoch,
    unavailableReason: OwnerLockUnavailableReason
  ): CoordinatorAction[] {
    const state = this.stateValue;
    if (
      state.kind !== 'activating' ||
      state.tabId !== tabId ||
      state.ownerEpoch !== ownerEpoch ||
      startupPhaseMayTouchStorage(state.phase)
    )
      return [];
    return this.retryLater(
      state,
      OWNER_LOCK_UNAVAILABLE_REASON,
      unavailableReason
    );
  }

  /**
   * The engine held the owner lock, but another context kept the database
   * files open through the engine's bounded wait, usually a predecessor worker
   * that is still being torn down. Wiping cannot remove files that are open,
   * and they need no repair, so try again like after an unavailable owner lock.
   * The attempt's database action carries over: an open changed nothing, and
   * a wipe that removed one file must still finish.
   */
  storageBusy(tabId: string, ownerEpoch: OwnerEpoch): CoordinatorAction[] {
    const state = this.stateValue;
    if (
      state.kind !== 'activating' ||
      state.tabId !== tabId ||
      state.ownerEpoch !== ownerEpoch ||
      state.phase !== 'opening-database'
    )
      return [];
    return this.retryLater(state, STORAGE_BUSY_REASON, 'files-busy');
  }

  private retryLater(
    state: Extract<CoordinatorState, { kind: 'activating' }>,
    reason: string,
    unavailableReason: CacheUnavailableReason
  ): CoordinatorAction[] {
    const { tabId, ownerEpoch, databaseAction } = state;
    if (this.handsOverNow(databaseAction)) return this.completeSupersede();
    this.stateValue = {
      kind: 'resetting-after-loss',
      previousTabId: tabId,
      previousEpoch: ownerEpoch,
      nextEpoch: this.currentEpoch + 1,
      databaseAction,
      reason,
    };
    this.assertInvariants();
    return [
      { kind: 'close-engine-route', tabId, ownerEpoch },
      ...this.beginOutage(reason, unavailableReason),
      { kind: 'schedule-reset-activation' },
    ];
  }

  /**
   * Nothing serves the cache until an engine opens the database. Refuses the
   * queued work: its pages go to the network meanwhile. They hear why before
   * that, as a refused request does not say it.
   */
  beginOutage(
    reason: string,
    unavailableReason: CacheUnavailableReason
  ): CoordinatorAction[] {
    if (this.supersededReason !== undefined || this.outage) return [];
    this.outage = { reason, unavailableReason };
    const held = this.queuedRequests.splice(0);
    this.queuedRequests.push(
      ...held.filter(({ request }) => isHeldThroughOutage(request))
    );
    return [
      { kind: 'broadcast-cache-unavailable', reason, unavailableReason },
      ...held
        .filter(({ request }) => !isHeldThroughOutage(request))
        .map(({ tabId, request }) =>
          this.rejectUnavailable(tabId, request.id, reason)
        ),
    ];
  }

  /** A newer app build holds the database, and an older one never opens it
   * after that: this build's tabs move on. */
  heldByNewerBuild(tabId: string, ownerEpoch: OwnerEpoch): CoordinatorAction[] {
    const state = this.stateValue;
    if (
      state.kind !== 'activating' ||
      state.tabId !== tabId ||
      state.ownerEpoch !== ownerEpoch ||
      startupPhaseMayTouchStorage(state.phase)
    )
      return [];
    return this.completeSupersede();
  }

  /** Grant storage access only once the engine holds the owner lock. Before
   * this grant an abandoned worker cannot have changed OPFS, so its successor
   * preserves it.
   */
  beginEngineOpen(tabId: string, ownerEpoch: OwnerEpoch): boolean {
    const state = this.stateValue;
    if (
      state.kind !== 'activating' ||
      state.tabId !== tabId ||
      state.ownerEpoch !== ownerEpoch ||
      state.phase !== 'awaiting-owner-lock'
    )
      return false;
    this.stateValue = { ...state, phase: 'opening-database' };
    return true;
  }

  engineReady(ready: EngineReady): CoordinatorAction[] {
    const state = this.stateValue;
    if (
      state.kind !== 'activating' ||
      state.tabId !== ready.tabId ||
      state.ownerEpoch !== ready.ownerEpoch ||
      state.phase !== 'opening-database'
    ) {
      return this.recordProtocolViolation(
        `unexpected engine-ready from ${ready.tabId} at epoch ${ready.ownerEpoch}`
      );
    }

    let error: string | undefined;
    if (!ready.ownerLockHeld) {
      error = 'engine became ready without the exclusive owner lock';
    } else if (ready.ownerLockName !== ready.expectedOwnerLockName) {
      error = 'engine reported the wrong physical owner lock';
    } else if (ready.databaseActionProof !== proofFor(ready.openOutcome)) {
      error = `engine proof does not match open outcome ${ready.openOutcome}`;
    }
    if (error) {
      return [
        ...this.recordProtocolViolation(error),
        ...this.transitionToAbruptLoss(state.tabId, state.ownerEpoch, error),
      ];
    }

    this.stateValue = {
      kind: 'active',
      tabId: state.tabId,
      ownerEpoch: state.ownerEpoch,
    };
    this.outage = undefined;
    this.hiddenDrainDeferred = false;
    const actions: CoordinatorAction[] = [];
    if (state.ownerEpoch > 1) {
      actions.push({
        kind: 'broadcast-engine-replaced',
        ownerEpoch: state.ownerEpoch,
        openOutcome: ready.openOutcome,
        queue: ready.queue,
      });
    }
    // A reset queue holds none of the heads claimed from the one before.
    if (ready.queue === 'reset') this.claims.clear();
    if (this.supersedePending && !this.awaitingSettlements) {
      actions.push(...this.drainForNewerBuild(this.stateValue));
      return actions;
    }
    // A hidden engine may have reset storage before it immediately drains.
    // Notify hosts of that outcome, but leave queued work for its successor.
    const drain = ready.hiddenBriefly
      ? []
      : this.drainHiddenOwner(state.ownerEpoch);
    if (drain.length > 0) return [...actions, ...drain];
    const held = this.queuedRequests.splice(0);
    for (const queued of inEngineArrivalOrder(held)) {
      if (this.holdsForNewerBuild(queued.request)) {
        this.queuedRequests.push(queued);
      } else if (
        this.tabs.includes(queued.tabId) ||
        isMutationSettlement(queued.request)
      ) {
        actions.push(this.route(queued, this.stateValue));
      }
    }
    this.assertInvariants();
    return actions;
  }

  engineResponse(
    ownerEpoch: OwnerEpoch,
    routeId: RouteId,
    response: CacheResponse
  ): CoordinatorAction[] {
    if (!this.acceptsEngineMessages(ownerEpoch)) {
      return [this.dropStale(ownerEpoch, routeId, 'stale-epoch')];
    }
    const request = this.inFlight.get(routeId);
    if (!request || request.ownerEpoch !== ownerEpoch) {
      return [this.dropStale(ownerEpoch, routeId, 'unknown-route')];
    }

    this.inFlight.delete(routeId);
    const actions = this.broadcastCacheChanges(
      this.cacheChanges.requestCompleted(this.inFlight.size === 0)
    );
    const claimed = claimedTransaction(request.request, response);
    if (this.tabs.includes(request.tabId)) {
      if (claimed !== undefined) {
        this.claims.set(claimed.transactionId, {
          tabId: request.tabId,
          leaseGeneration: claimed.leaseGeneration,
        });
        actions.push({
          kind: 'claim-lease',
          ...claimed,
          ms: leaseMs(request.request),
        });
        // A head claimed during the wait gets a wait of its own.
        if (this.awaitingSettlements) actions.push(this.awaitSettlements());
      }
      actions.push({
        kind: 'deliver-response',
        tabId: request.tabId,
        response: { ...response, id: request.request.id },
      });
    }
    if (request.request.kind === 'clear' && response.ok) this.claims.clear();
    // A settlement the engine answered took the head out, put it back, or
    // found it gone (a failed commit rolls back); one it could not write keeps
    // the claim for a retry.
    if (isMutationSettlement(request.request) && response.ok)
      this.forgetClaim(
        request.request.transactionId,
        request.request.leaseGeneration
      );
    actions.push(...this.afterSettlement());
    return actions;
  }

  /** The claim's lease ran out: another page may claim its head now. */
  claimLeaseEnded(
    transactionId: string,
    leaseGeneration: string | undefined
  ): CoordinatorAction[] {
    this.forgetClaim(transactionId, leaseGeneration);
    return this.afterSettlement();
  }

  /** Hands over, or drains a hidden owner that stayed only for these heads. */
  private afterSettlement(): CoordinatorAction[] {
    const handover = this.handOverIfSettled();
    const state = this.stateValue;
    if (
      handover.length > 0 ||
      !this.hiddenDrainDeferred ||
      state.kind !== 'active' ||
      this.awaitingSettlements ||
      this.unsettled()
    )
      return handover;
    return this.drainHiddenOwner(state.ownerEpoch);
  }

  /** From here on the wait claims no head: what it holds runs to the limit. */
  closeClaims(): void {
    if (this.awaitingSettlements) this.claimsClosed = true;
  }

  private forgetClaim(
    transactionId: string,
    leaseGeneration: string | undefined
  ): void {
    const claim = this.claims.get(transactionId);
    // An older lease settles nothing of the head claimed again since.
    if (
      claim?.leaseGeneration === undefined ||
      leaseGeneration === undefined ||
      claim.leaseGeneration === leaseGeneration
    )
      this.claims.delete(transactionId);
  }

  enginePush(ownerEpoch: OwnerEpoch, push: CachePush): CoordinatorAction[] {
    if (!this.acceptsEngineMessages(ownerEpoch)) {
      return [this.dropStale(ownerEpoch, undefined, 'stale-epoch')];
    }
    if (push.kind !== 'cache-changed' && push.kind !== 'cache-hydrated') {
      return [{ kind: 'broadcast-push', push }];
    }
    // The engine's local queue can look empty between MessagePort deliveries.
    // Only the coordinator knows how much accepted work remains in transit.
    this.cacheChanges.add(push);
    if (
      this.inFlight.size <= 1 ||
      (push.kind === 'cache-changed' && push.reset)
    ) {
      return this.broadcastCacheChanges(this.cacheChanges.flush());
    }
    return [];
  }

  private broadcastCacheChanges(
    changes: CoalescedCacheChange[]
  ): CoordinatorAction[] {
    return changes.map(({ push, count }) => ({
      kind: 'broadcast-push',
      push,
      ...(count > 1 ? { coalescedCount: count } : {}),
    }));
  }

  /**
   * Drains the departing page's engine. A page that no longer owns, at that
   * epoch, an engine to drain is told so by the `terminate-engine` that ended
   * the epoch, and leaves on that instead.
   */
  beginGracefulDeparture(
    tabId: string,
    ownerEpoch: OwnerEpoch
  ): CoordinatorAction[] {
    const state = this.stateValue;
    if (
      (state.kind !== 'active' && state.kind !== 'draining') ||
      state.tabId !== tabId ||
      state.ownerEpoch !== ownerEpoch
    ) {
      return [];
    }
    this.retiringTabs.add(tabId);
    // An explicit disposal may join an already-running visibility handoff.
    if (state.kind === 'draining') return [];
    this.stateValue = { kind: 'draining', tabId, ownerEpoch };
    return [{ kind: 'drain-owner', tabId, ownerEpoch }];
  }

  engineDrained(tabId: string, ownerEpoch: OwnerEpoch): CoordinatorAction[] {
    const state = this.stateValue;
    if (
      state.kind !== 'draining' ||
      state.tabId !== tabId ||
      state.ownerEpoch !== ownerEpoch
    ) {
      return this.recordProtocolViolation(
        `unexpected engine-drained from ${tabId} at epoch ${ownerEpoch}`
      );
    }
    return this.endDrain(
      state,
      'engine drained before delivering its response',
      'visibility handoff drained'
    );
  }

  /** The drain is cut short the way a page that leaves cuts its engine off:
   * the database recovers from it, so it calls for no wipe. */
  drainExpired(
    tabId: string,
    ownerEpoch: OwnerEpoch,
    reason: string
  ): CoordinatorAction[] {
    const state = this.stateValue;
    if (
      state.kind !== 'draining' ||
      state.tabId !== tabId ||
      state.ownerEpoch !== ownerEpoch
    )
      return [];
    return this.endDrain(state, reason, reason);
  }

  private endDrain(
    { tabId, ownerEpoch }: Extract<CoordinatorState, { kind: 'draining' }>,
    error: string,
    releaseReason: string
  ): CoordinatorAction[] {
    const actions = this.rejectEpochRequests(
      ownerEpoch,
      error,
      OWNER_EPOCH_LOST_ERROR_CODE
    );
    actions.push({ kind: 'close-engine-route', tabId, ownerEpoch });
    if (this.retiringTabs.delete(tabId)) {
      this.removeTabRecord(tabId);
      actions.push({ kind: 'retire-tab', tabId, ownerEpoch });
    } else {
      // The engine closed storage, not the page. Its host and subscriptions
      // remain connected and the usual replacement broadcast refreshes them.
      actions.push({
        kind: 'release-owner',
        tabId,
        ownerEpoch,
        reason: releaseReason,
      });
    }
    this.stateValue = {
      kind: 'waiting-for-tab',
      nextDatabaseAction: 'open-existing',
    };
    actions.push(...this.endWaitIfSettled());
    actions.push(
      ...(this.handsOverNow('open-existing')
        ? this.completeSupersede()
        : this.activateNext('open-existing'))
    );
    this.assertInvariants();
    return actions;
  }

  /** `takenOver` says another context holds the database by now, so whatever
   * this owner left of it is that one's to judge. */
  ownerLost(
    tabId: string,
    ownerEpoch: OwnerEpoch,
    reason: string,
    takenOver = false
  ): CoordinatorAction[] {
    return this.transitionToAbruptLoss(tabId, ownerEpoch, reason, takenOver);
  }

  /**
   * A newer app build takes the database over. Every tab moves to that build,
   * and nothing is elected afterwards. A running engine is drained first, so
   * what it was given is settled. While an engine is opening, recovering, or
   * draining the database its files may be changing, so the handover waits
   * until that engine has settled.
   */
  supersede(): CoordinatorAction[] {
    const state = this.stateValue;
    if (this.supersededReason !== undefined) return [];
    if (this.unsettled() && state.kind !== 'waiting-for-tab') {
      // A page may have a claimed head on its way to the server. Its answer
      // must reach an engine of this build, or another page sends it again.
      this.supersedePending = true;
      this.awaitingSettlements = true;
      const wait = this.awaitSettlements();
      // Every tab is hidden, so no engine runs to write the answer: start one.
      if (state.kind === 'parked')
        return [wait, ...this.activateNext(state.nextDatabaseAction)];
      return [wait];
    }
    if (
      state.kind === 'draining' ||
      (state.kind === 'resetting-after-loss' && !this.outage) ||
      (state.kind === 'activating' && startupPhaseMayTouchStorage(state.phase))
    ) {
      this.supersedePending = true;
      return [];
    }
    if (state.kind === 'active') return this.drainForNewerBuild(state);
    return this.completeSupersede();
  }

  /** The pages had their time to settle their claims. */
  settlementsOverdue(): CoordinatorAction[] {
    if (!this.awaitingSettlements) return [];
    const unsettled = this.claims.size;
    this.claims.clear();
    return this.handOverIfSettled(unsettled, true);
  }

  private awaitSettlements(): CoordinatorAction {
    return {
      kind: 'await-settlements',
      ms: SETTLEMENT_WAIT_MS,
      claims: this.claims.size,
    };
  }

  /** A claimed head is unsettled, or a request on its way may claim one. */
  private unsettled(): boolean {
    if (this.claims.size > 0) return true;
    for (const { request } of this.inFlight.values())
      if (mayClaim(request)) return true;
    // A settlement handed over already must still be written, even when the
    // page that sent it has gone.
    return this.queuedRequests.some(({ request }) =>
      isMutationSettlement(request)
    );
  }

  /** While a newer build waits, no page claims a head the wait does not see. */
  private holdsForNewerBuild(request: CacheRequest): boolean {
    if (!this.awaitingSettlements) return false;
    return request.kind === 'claim-next-mutation';
  }

  /** Hands the database to the newer build once nothing claimed is unsettled. */
  private handOverIfSettled(
    unsettled = 0,
    overdue = false
  ): CoordinatorAction[] {
    const ended = this.endWaitIfSettled(unsettled, overdue);
    if (ended.length === 0) return [];
    const state = this.stateValue;
    if (state.kind === 'active')
      return [...ended, ...this.drainForNewerBuild(state)];
    // No engine runs, so nothing is left to drain; one starting or stopping
    // hands over when it is done.
    if (state.kind === 'waiting-for-tab' || state.kind === 'parked')
      return [...ended, ...this.completeSupersede()];
    return ended;
  }

  private endWaitIfSettled(
    unsettled = 0,
    overdue = false
  ): CoordinatorAction[] {
    if (!this.awaitingSettlements || (!overdue && this.unsettled())) return [];
    this.awaitingSettlements = false;
    return [{ kind: 'settlement-wait-ended', unsettled }];
  }

  /** The engine stopped while the newer build waits: start another, unless
   * it would reset the database promised to that build. */
  private handsOverNow(nextDatabaseAction: DatabaseAction): boolean {
    return (
      this.supersedePending &&
      (!this.awaitingSettlements || nextDatabaseAction !== 'open-existing')
    );
  }

  private drainForNewerBuild({
    tabId,
    ownerEpoch,
  }: Extract<CoordinatorState, { kind: 'active' }>): CoordinatorAction[] {
    this.supersedePending = true;
    this.stateValue = { kind: 'draining', tabId, ownerEpoch };
    return [{ kind: 'drain-owner', tabId, ownerEpoch, handoff: true }];
  }

  private completeSupersede(): CoordinatorAction[] {
    const ended: CoordinatorAction[] = this.awaitingSettlements
      ? [{ kind: 'settlement-wait-ended', unsettled: this.claims.size }]
      : [];
    this.supersedePending = false;
    this.awaitingSettlements = false;
    this.claimsClosed = false;
    this.claims.clear();
    const reason = SUPERSEDED_REASON;
    this.supersededReason = reason;
    const actions: CoordinatorAction[] = [
      ...ended,
      ...this.releaseStartingOwner(reason),
      ...this.broadcastCacheChanges(this.cacheChanges.flush()),
      ...this.queuedRequests
        .splice(0)
        .map(({ tabId, request }) =>
          this.rejectSuperseded(tabId, request.id, reason)
        ),
    ];
    actions.push({ kind: 'broadcast-cache-superseded', reason });
    this.assertInvariants();
    return actions;
  }

  /** An engine that was not let at the database yet, and no longer is. */
  private releaseStartingOwner(reason: string): CoordinatorAction[] {
    const state = this.stateValue;
    if (state.kind !== 'activating') return [];
    const { tabId, ownerEpoch, databaseAction } = state;
    this.stateValue = {
      kind: 'waiting-for-tab',
      nextDatabaseAction: databaseAction,
    };
    return [
      { kind: 'close-engine-route', tabId, ownerEpoch },
      { kind: 'release-owner', tabId, ownerEpoch, reason },
    ];
  }

  departForNavigation(
    tabId: string,
    ownerEpoch: OwnerEpoch,
    reason: string
  ): CoordinatorAction[] {
    const state = this.stateValue;
    if (
      (state.kind !== 'active' &&
        state.kind !== 'activating' &&
        state.kind !== 'draining') ||
      state.tabId !== tabId ||
      state.ownerEpoch !== ownerEpoch
    ) {
      return this.recordProtocolViolation(
        `unexpected navigation departure from ${tabId} at epoch ${ownerEpoch}`
      );
    }

    return this.ownerLeft(
      state,
      `owner epoch ${ownerEpoch} departed for navigation: ${reason}`
    );
  }

  /**
   * A page that is gone, or that disposed its cache, stopped its engine worker
   * the way a navigating page does. That interrupts the engine at a point the
   * database recovers from, so it never calls for a wipe.
   */
  tabLost(
    tabId: string,
    reason = 'tab liveness lock was released'
  ): CoordinatorAction[] {
    if (!this.tabs.includes(tabId)) return [];
    const state = this.stateValue;
    if (
      (state.kind === 'active' ||
        state.kind === 'activating' ||
        state.kind === 'draining') &&
      state.tabId === tabId
    ) {
      return this.ownerLeft(
        state,
        `owner epoch ${state.ownerEpoch} was lost: ${reason}`
      );
    }

    const actions: CoordinatorAction[] = [{ kind: 'drop-tab', tabId }];
    this.removeTabRecord(tabId);
    this.retiringTabs.delete(tabId);
    if (this.inFlight.size === 0) {
      actions.push(...this.broadcastCacheChanges(this.cacheChanges.flush()));
    }
    actions.push(...this.handOverIfSettled());
    this.assertInvariants();
    return actions;
  }

  /** The owner's page left with its engine. The next owner opens the same
   * database, unless a wipe was already due. */
  private ownerLeft(
    state: Extract<
      CoordinatorState,
      { kind: 'activating' | 'active' | 'draining' }
    >,
    error: string
  ): CoordinatorAction[] {
    const { tabId, ownerEpoch } = state;
    const nextDatabaseAction: DatabaseAction =
      state.kind === 'activating' ? state.databaseAction : 'open-existing';
    const actions = this.rejectEpochRequests(
      ownerEpoch,
      error,
      OWNER_EPOCH_LOST_ERROR_CODE
    );
    this.removeTabRecord(tabId);
    this.retiringTabs.delete(tabId);
    actions.push(
      { kind: 'close-engine-route', tabId, ownerEpoch },
      { kind: 'drop-tab', tabId }
    );
    this.stateValue = { kind: 'waiting-for-tab', nextDatabaseAction };
    actions.push(...this.endWaitIfSettled());
    actions.push(
      ...(this.handsOverNow(nextDatabaseAction)
        ? this.completeSupersede()
        : this.activateNext(nextDatabaseAction))
    );
    this.assertInvariants();
    return actions;
  }

  resumeAfterLoss(): CoordinatorAction[] {
    const state = this.stateValue;
    if (state.kind !== 'resetting-after-loss') return [];
    if (this.handsOverNow(state.databaseAction)) {
      // The lost engine was promised to a newer build. Hand over now instead
      // of electing a reset owner that would wipe the database it agreed to
      // yield, queued mutations included.
      this.stateValue = {
        kind: 'waiting-for-tab',
        nextDatabaseAction: state.databaseAction,
      };
      return this.completeSupersede();
    }
    const candidate = this.chooseCandidate(state.previousTabId);
    if (!candidate) {
      this.stateValue = {
        kind: this.eligibleTabs().length > 0 ? 'parked' : 'waiting-for-tab',
        nextDatabaseAction: state.databaseAction,
      };
      return [];
    }
    this.currentEpoch = state.nextEpoch;
    this.noteElection(candidate, state.nextEpoch);
    this.stateValue = {
      kind: 'activating',
      tabId: candidate,
      ownerEpoch: state.nextEpoch,
      databaseAction: state.databaseAction,
      phase: 'loading-assets',
    };
    return [
      {
        kind: 'elect-owner',
        tabId: candidate,
        ownerEpoch: state.nextEpoch,
        databaseAction: state.databaseAction,
      },
    ];
  }

  expectsEngine(tabId: string, ownerEpoch: OwnerEpoch): boolean {
    return (
      this.stateValue.kind === 'activating' &&
      this.stateValue.tabId === tabId &&
      this.stateValue.ownerEpoch === ownerEpoch
    );
  }

  private transitionToAbruptLoss(
    tabId: string,
    ownerEpoch: OwnerEpoch,
    reason: string,
    takenOver = false
  ): CoordinatorAction[] {
    const state = this.stateValue;
    if (
      (state.kind !== 'active' &&
        state.kind !== 'activating' &&
        state.kind !== 'draining') ||
      state.tabId !== tabId ||
      state.ownerEpoch !== ownerEpoch
    ) {
      return [];
    }

    const untouched =
      state.kind === 'activating' && !startupPhaseMayTouchStorage(state.phase);
    const lostAction: DatabaseAction = takenOver
      ? 'open-existing'
      : 'wipe-before-open';
    const actions = this.rejectEpochRequests(
      ownerEpoch,
      `owner epoch ${ownerEpoch} was lost: ${reason}`,
      OWNER_EPOCH_LOST_ERROR_CODE
    );
    actions.push(
      { kind: 'close-engine-route', tabId, ownerEpoch },
      { kind: 'schedule-reset-activation' }
    );
    this.stateValue = {
      kind: 'resetting-after-loss',
      previousTabId: tabId,
      previousEpoch: ownerEpoch,
      nextEpoch: this.currentEpoch + 1,
      databaseAction: untouched ? state.databaseAction : lostAction,
      reason,
    };
    this.assertInvariants();
    return actions;
  }

  private rejectEpochRequests(
    ownerEpoch: OwnerEpoch,
    error: string,
    errorCode?: CacheResponseErrorCode
  ): CoordinatorAction[] {
    // Never carry a committed hint into another engine's revision space.
    const actions = this.broadcastCacheChanges(this.cacheChanges.flush());
    for (const [routeId, request] of this.inFlight) {
      if (request.ownerEpoch !== ownerEpoch) continue;
      this.inFlight.delete(routeId);
      // While a newer build waits, the next engine writes it instead: the
      // head is fenced by its lease, and refusing it here would leave the
      // head for the newer build to send again.
      if (
        this.awaitingSettlements &&
        isMutationSettlement(request.request) &&
        this.claims.has(request.request.transactionId)
      ) {
        const { tabId, request: settlement, queuedAt } = request;
        this.queuedRequests.push({ tabId, request: settlement, queuedAt });
        continue;
      }
      // Fencing an engine does not undo a durable enqueue. Even a planned
      // reset has not erased it yet, so a missing reply must never cause
      // the caller to retry or forward the mutation directly to the API.
      const requestErrorCode =
        request.request.kind === 'enqueue-optimistic-mutation'
          ? ADMITTED_ENQUEUE_UNCERTAIN_ERROR_CODE
          : errorCode;
      actions.push(
        this.reject(request.tabId, request.request.id, error, requestErrorCode)
      );
    }
    return actions;
  }

  private activateNext(databaseAction: DatabaseAction): CoordinatorAction[] {
    const candidate = this.chooseCandidate();
    if (!candidate) {
      this.stateValue = {
        kind: this.eligibleTabs().length > 0 ? 'parked' : 'waiting-for-tab',
        nextDatabaseAction: databaseAction,
      };
      return [];
    }
    this.currentEpoch += 1;
    this.noteElection(candidate, this.currentEpoch);
    this.stateValue = {
      kind: 'activating',
      tabId: candidate,
      ownerEpoch: this.currentEpoch,
      databaseAction,
      phase: 'loading-assets',
    };
    return [
      {
        kind: 'elect-owner',
        tabId: candidate,
        ownerEpoch: this.currentEpoch,
        databaseAction,
      },
    ];
  }

  /** A starting owner that is hidden finishes its startup, then drains. A
   * serving one is drained by `drainHiddenOwner` once it stayed hidden. */
  private handoffIfNeeded(): CoordinatorAction[] {
    const state = this.stateValue;
    if (state.kind !== 'activating' || this.visibleTabs.has(state.tabId))
      return [];
    return [{ kind: 'handoff-pending', ownerEpoch: state.ownerEpoch }];
  }

  /** Whether the engine that serves the cache, or is starting to, belongs to a
   * hidden page. */
  get ownerHidden(): boolean {
    const state = this.stateValue;
    return (
      (state.kind === 'active' || state.kind === 'activating') &&
      !this.visibleTabs.has(state.tabId)
    );
  }

  drainHiddenOwner(ownerEpoch: OwnerEpoch): CoordinatorAction[] {
    const state = this.stateValue;
    if (
      state.kind !== 'active' ||
      state.ownerEpoch !== ownerEpoch ||
      this.visibleTabs.has(state.tabId)
    )
      return [];
    // Its pages' settlements land here. With no visible tab to take over,
    // holding the lock also makes a newer build ask for the database rather
    // than open it under a head still out. It drains once they have settled,
    // or the newer build drains it.
    if (this.awaitingSettlements || (this.unsettled() && !this.hasVisibleTab)) {
      this.hiddenDrainDeferred = true;
      return [];
    }
    this.hiddenDrainDeferred = false;
    this.stateValue = { ...state, kind: 'draining' };
    return [
      {
        kind: 'drain-owner',
        tabId: state.tabId,
        ownerEpoch: state.ownerEpoch,
        handoff: true,
      },
    ];
  }

  private eligibleTabs(): string[] {
    if (this.supersededReason !== undefined) return [];
    return this.tabs.filter((tabId) => !this.retiringTabs.has(tabId));
  }

  private chooseCandidate(avoid?: string): string | undefined {
    const eligible = this.eligibleTabs();
    const visible = eligible.filter((tabId) => this.visibleTabs.has(tabId));
    // A claimed head is settled by an engine of this build, even a hidden
    // one: a parked build holds no lock, and a newer build would open the
    // database under the head. The pages sending its answer go first, since
    // a frozen tab elsewhere would never open the engine.
    const candidates =
      visible.length === 0 && this.unsettled()
        ? [...eligible].sort(
            (a, b) =>
              Number(this.sendsSettlement(b)) - Number(this.sendsSettlement(a))
          )
        : visible;
    return candidates.find((tabId) => tabId !== avoid) ?? candidates[0];
  }

  private noteElection(tabId: string, ownerEpoch: OwnerEpoch): void {
    this.hiddenElectionEpoch = this.visibleTabs.has(tabId)
      ? undefined
      : ownerEpoch;
  }

  /** The tab claimed a head still out, or handed over its settlement. */
  private sendsSettlement(tabId: string): boolean {
    for (const claim of this.claims.values())
      if (claim.tabId === tabId) return true;
    return this.queuedRequests.some(
      (queued) => queued.tabId === tabId && isMutationSettlement(queued.request)
    );
  }

  private route(
    queued: QueuedRequest,
    state: Extract<CoordinatorState, { kind: 'active' }>
  ): Extract<CoordinatorAction, { kind: 'route-request' }> {
    if (!Number.isSafeInteger(this.nextRouteId)) {
      throw new Error('coordinator route id space exhausted');
    }
    const routeId = this.nextRouteId++;
    this.inFlight.set(routeId, {
      ...queued,
      routeId,
      ownerEpoch: state.ownerEpoch,
    });
    return {
      kind: 'route-request',
      ownerTabId: state.tabId,
      requesterTabId: queued.tabId,
      ownerEpoch: state.ownerEpoch,
      routeId,
      request: { ...queued.request, id: routeId },
    };
  }

  private removeTabRecord(tabId: string): void {
    const index = this.tabs.indexOf(tabId);
    if (index >= 0) this.tabs.splice(index, 1);
    this.visibleTabs.delete(tabId);
    for (let index = this.queuedRequests.length - 1; index >= 0; index -= 1) {
      const queued = this.queuedRequests[index];
      if (queued?.tabId === tabId && !isMutationSettlement(queued.request)) {
        this.queuedRequests.splice(index, 1);
      }
    }
    for (const [routeId, request] of this.inFlight) {
      if (request.tabId === tabId) this.inFlight.delete(routeId);
    }
    // A page that left settles nothing; another page sends its head.
    for (const [transactionId, claim] of this.claims)
      if (claim.tabId === tabId) this.claims.delete(transactionId);
  }

  private acceptsEngineMessages(ownerEpoch: OwnerEpoch): boolean {
    return (
      (this.stateValue.kind === 'active' ||
        this.stateValue.kind === 'draining') &&
      this.stateValue.ownerEpoch === ownerEpoch
    );
  }

  private reject(
    tabId: string,
    requestId: number,
    error: string,
    errorCode?: CacheResponseErrorCode
  ): Extract<CoordinatorAction, { kind: 'reject-request' }> {
    return {
      kind: 'reject-request',
      tabId,
      requestId,
      error,
      ...(errorCode === undefined ? {} : { errorCode }),
    };
  }

  private rejectUnavailable(
    tabId: string,
    requestId: number,
    reason: string
  ): Extract<CoordinatorAction, { kind: 'reject-request' }> {
    return this.reject(
      tabId,
      requestId,
      reason,
      OWNER_LOCK_UNAVAILABLE_ERROR_CODE
    );
  }

  private rejectSuperseded(
    tabId: string,
    requestId: number,
    reason: string
  ): Extract<CoordinatorAction, { kind: 'reject-request' }> {
    return this.reject(tabId, requestId, reason, CACHE_SUPERSEDED_ERROR_CODE);
  }

  private dropStale(
    ownerEpoch: OwnerEpoch,
    routeId: RouteId | undefined,
    reason: Extract<
      CoordinatorAction,
      { kind: 'drop-stale-engine-message' }
    >['reason']
  ): Extract<CoordinatorAction, { kind: 'drop-stale-engine-message' }> {
    this.staleMessageDrops += 1;
    return {
      kind: 'drop-stale-engine-message',
      ownerEpoch,
      routeId,
      reason,
    };
  }

  private recordProtocolViolation(error: string): CoordinatorAction[] {
    this.protocolViolations += 1;
    return [{ kind: 'protocol-violation', error }];
  }

  private assertInvariants(): void {
    if (
      this.stateValue.kind !== 'active' &&
      this.stateValue.kind !== 'draining'
    ) {
      if (this.inFlight.size > 0) {
        throw new Error('invariant: requests are in flight without an owner');
      }
      return;
    }
    for (const request of this.inFlight.values()) {
      if (request.ownerEpoch !== this.stateValue.ownerEpoch) {
        throw new Error('invariant: in-flight request has a stale owner epoch');
      }
    }
  }
}

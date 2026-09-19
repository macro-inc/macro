import {
  type CachePush,
  type CacheRequest,
  type CacheResponse,
  type CacheResponseErrorCode,
  OWNER_EPOCH_LOST_ERROR_CODE,
} from '../protocol';
import type {
  DatabaseAction,
  DatabaseActionProof,
  EngineOpenOutcome,
  OwnerEpoch,
  RouteId,
} from './coordinator-protocol';

export type CoordinatorState =
  | { kind: 'waiting-for-tab'; nextDatabaseAction: DatabaseAction }
  | {
      kind: 'activating';
      tabId: string;
      ownerEpoch: OwnerEpoch;
      databaseAction: DatabaseAction;
    }
  | { kind: 'active'; tabId: string; ownerEpoch: OwnerEpoch }
  | { kind: 'draining'; tabId: string; ownerEpoch: OwnerEpoch }
  | {
      kind: 'resetting-after-loss';
      previousTabId: string;
      previousEpoch: OwnerEpoch;
      nextEpoch: OwnerEpoch;
      reason: string;
    }
  | { kind: 'failed'; reason: string };

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
  | { kind: 'broadcast-push'; push: CachePush }
  | {
      kind: 'reject-request';
      tabId: string;
      requestId: number;
      error: string;
      errorCode?: CacheResponseErrorCode;
    }
  | { kind: 'drain-owner'; tabId: string; ownerEpoch: OwnerEpoch }
  | { kind: 'close-engine-route'; tabId: string; ownerEpoch: OwnerEpoch }
  | { kind: 'drop-tab'; tabId: string }
  | { kind: 'retire-tab'; tabId: string; ownerEpoch: OwnerEpoch }
  | { kind: 'schedule-reset-activation' }
  | { kind: 'broadcast-engine-replaced'; ownerEpoch: OwnerEpoch }
  | {
      kind: 'drop-stale-engine-message';
      ownerEpoch: OwnerEpoch;
      routeId?: RouteId;
      reason: 'stale-epoch' | 'unknown-route' | 'inactive-engine';
    }
  | { kind: 'protocol-violation'; error: string }
  | { kind: 'terminal-failure'; error: string };

export type EngineReady = {
  tabId: string;
  ownerEpoch: OwnerEpoch;
  ownerLockName: string;
  expectedOwnerLockName: string;
  ownerLockHeld: true;
  databaseActionProof: DatabaseActionProof;
  openOutcome: EngineOpenOutcome;
};

const proofFor = (outcome: EngineOpenOutcome): DatabaseActionProof =>
  outcome.startsWith('reset-') ? 'wiped-before-open' : 'opened-existing';

/** Pure election, epoch, routing, drain, and abrupt-loss state machine. */
export class CoordinatorCore {
  private stateValue: CoordinatorState = {
    kind: 'waiting-for-tab',
    nextDatabaseAction: 'open-existing',
  };
  private readonly tabs: string[] = [];
  private readonly retiringTabs = new Set<string>();
  private readonly queuedRequests: QueuedRequest[] = [];
  private readonly inFlight = new Map<RouteId, InFlightRequest>();
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

  registerTab(tabId: string): CoordinatorAction[] {
    if (this.tabs.includes(tabId)) return [];
    this.tabs.push(tabId);
    if (this.stateValue.kind === 'failed') {
      return [{ kind: 'terminal-failure', error: this.stateValue.reason }];
    }
    if (this.stateValue.kind !== 'waiting-for-tab') return [];
    return this.activateNext(this.stateValue.nextDatabaseAction);
  }

  request(tabId: string, request: CacheRequest): CoordinatorAction[] {
    if (!this.tabs.includes(tabId)) {
      return [
        this.reject(tabId, request.id, 'requester tab is not registered'),
      ];
    }
    if (this.retiringTabs.has(tabId)) {
      return [this.reject(tabId, request.id, 'requester tab is retiring')];
    }
    if (this.stateValue.kind === 'failed') {
      return [this.reject(tabId, request.id, this.stateValue.reason)];
    }

    const queued = { tabId, request };
    if (this.stateValue.kind !== 'active') {
      this.queuedRequests.push(queued);
      return [];
    }
    return [this.route(queued, this.stateValue)];
  }

  engineReady(ready: EngineReady): CoordinatorAction[] {
    const state = this.stateValue;
    if (
      state.kind !== 'activating' ||
      state.tabId !== ready.tabId ||
      state.ownerEpoch !== ready.ownerEpoch
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
    const actions: CoordinatorAction[] = [];
    if (state.ownerEpoch > 1) {
      actions.push({
        kind: 'broadcast-engine-replaced',
        ownerEpoch: state.ownerEpoch,
      });
    }
    while (this.queuedRequests.length > 0) {
      const queued = this.queuedRequests.shift();
      if (queued && this.tabs.includes(queued.tabId)) {
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
    return [
      {
        kind: 'deliver-response',
        tabId: request.tabId,
        response: { ...response, id: request.request.id },
      },
    ];
  }

  enginePush(ownerEpoch: OwnerEpoch, push: CachePush): CoordinatorAction[] {
    if (!this.acceptsEngineMessages(ownerEpoch)) {
      return [this.dropStale(ownerEpoch, undefined, 'stale-epoch')];
    }
    return [{ kind: 'broadcast-push', push }];
  }

  beginGracefulDeparture(
    tabId: string,
    ownerEpoch: OwnerEpoch
  ): CoordinatorAction[] {
    const state = this.stateValue;
    if (
      state.kind !== 'active' ||
      state.tabId !== tabId ||
      state.ownerEpoch !== ownerEpoch
    ) {
      return this.recordProtocolViolation(
        `unexpected graceful departure from ${tabId} at epoch ${ownerEpoch}`
      );
    }
    this.retiringTabs.add(tabId);
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

    const actions = this.rejectEpochRequests(
      ownerEpoch,
      'engine drained before delivering its response'
    );
    this.removeTabRecord(tabId);
    this.retiringTabs.delete(tabId);
    actions.push(
      { kind: 'close-engine-route', tabId, ownerEpoch },
      { kind: 'retire-tab', tabId, ownerEpoch }
    );
    this.stateValue = {
      kind: 'waiting-for-tab',
      nextDatabaseAction: 'open-existing',
    };
    actions.push(...this.activateNext('open-existing'));
    this.assertInvariants();
    return actions;
  }

  ownerLost(
    tabId: string,
    ownerEpoch: OwnerEpoch,
    reason: string
  ): CoordinatorAction[] {
    return this.transitionToAbruptLoss(tabId, ownerEpoch, reason);
  }

  /** Stops owner recovery and fails every current or future page connection. */
  terminalFailure(reason: string): CoordinatorAction[] {
    if (this.stateValue.kind === 'failed') return [];
    this.queuedRequests.length = 0;
    this.inFlight.clear();
    this.stateValue = { kind: 'failed', reason };
    this.assertInvariants();
    return [{ kind: 'terminal-failure', error: reason }];
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

    const nextDatabaseAction: DatabaseAction =
      state.kind === 'activating' ? state.databaseAction : 'open-existing';
    const actions = this.rejectEpochRequests(
      ownerEpoch,
      `owner epoch ${ownerEpoch} departed for navigation: ${reason}`,
      OWNER_EPOCH_LOST_ERROR_CODE
    );
    this.removeTabRecord(tabId);
    this.retiringTabs.delete(tabId);
    actions.push(
      { kind: 'close-engine-route', tabId, ownerEpoch },
      { kind: 'drop-tab', tabId }
    );
    this.stateValue = {
      kind: 'waiting-for-tab',
      nextDatabaseAction,
    };
    actions.push(...this.activateNext(nextDatabaseAction));
    this.assertInvariants();
    return actions;
  }

  tabLost(
    tabId: string,
    reason = 'tab liveness lock was released'
  ): CoordinatorAction[] {
    if (!this.tabs.includes(tabId)) return [];
    const state = this.stateValue;
    const wasOwner =
      (state.kind === 'active' ||
        state.kind === 'activating' ||
        state.kind === 'draining') &&
      state.tabId === tabId;

    const actions: CoordinatorAction[] = [{ kind: 'drop-tab', tabId }];
    if (wasOwner) {
      actions.push(
        ...this.transitionToAbruptLoss(tabId, state.ownerEpoch, reason)
      );
    }
    this.removeTabRecord(tabId);
    this.retiringTabs.delete(tabId);
    this.assertInvariants();
    return actions;
  }

  resumeAfterLoss(): CoordinatorAction[] {
    const state = this.stateValue;
    if (state.kind !== 'resetting-after-loss') return [];
    const candidate = this.chooseCandidate(state.previousTabId);
    if (!candidate) {
      this.stateValue = {
        kind: 'waiting-for-tab',
        nextDatabaseAction: 'wipe-before-open',
      };
      return [];
    }
    this.currentEpoch = state.nextEpoch;
    this.stateValue = {
      kind: 'activating',
      tabId: candidate,
      ownerEpoch: state.nextEpoch,
      databaseAction: 'wipe-before-open',
    };
    return [
      {
        kind: 'elect-owner',
        tabId: candidate,
        ownerEpoch: state.nextEpoch,
        databaseAction: 'wipe-before-open',
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
      return [];
    }

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
    const actions: CoordinatorAction[] = [];
    for (const [routeId, request] of this.inFlight) {
      if (request.ownerEpoch !== ownerEpoch) continue;
      this.inFlight.delete(routeId);
      actions.push(
        this.reject(request.tabId, request.request.id, error, errorCode)
      );
    }
    return actions;
  }

  private activateNext(databaseAction: DatabaseAction): CoordinatorAction[] {
    const candidate = this.chooseCandidate();
    if (!candidate) {
      this.stateValue = {
        kind: 'waiting-for-tab',
        nextDatabaseAction: databaseAction,
      };
      return [];
    }
    this.currentEpoch += 1;
    this.stateValue = {
      kind: 'activating',
      tabId: candidate,
      ownerEpoch: this.currentEpoch,
      databaseAction,
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

  private chooseCandidate(avoid?: string): string | undefined {
    const eligible = this.tabs.filter((tabId) => !this.retiringTabs.has(tabId));
    return eligible.find((tabId) => tabId !== avoid) ?? eligible[0];
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
    for (let index = this.queuedRequests.length - 1; index >= 0; index -= 1) {
      if (this.queuedRequests[index]?.tabId === tabId) {
        this.queuedRequests.splice(index, 1);
      }
    }
    for (const [routeId, request] of this.inFlight) {
      if (request.tabId === tabId) this.inFlight.delete(routeId);
    }
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

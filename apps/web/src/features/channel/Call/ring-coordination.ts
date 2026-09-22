import { createCrossTabBus } from '@core/cross-tab/cross-tab-bus';
import { evictOldest } from '@core/util/evictOldest';
import {
  type Cleanup,
  createMachine,
  type Machine,
  type MachineDef,
} from '@macro-inc/machine';
import { match, P } from 'ts-pattern';

/**
 * Cross-tab election of a single audible ringer per incoming call, so a call
 * ringing in six tabs sounds like one phone instead of six.
 *
 * Every tab that would ring joins the election with `participateInRing`. A
 * participant claims the ring by publishing `(callId, tabId, claimedAt)` and
 * starts ringing immediately; all participants order claims by
 * `(audible desc, claimedAt asc, tabId asc)` and only the winner keeps
 * making noise, so near-simultaneous claimants converge within one message
 * round-trip. Tabs the user has never interacted with claim with
 * `audible: false` (their AudioContext is likely blocked by the autoplay
 * policy, so their ring would be silent) and any audibly-capable tab
 * outranks them.
 *
 * The audible tab re-publishes its claim as a heartbeat. When the heartbeats
 * stop mid-ring (tab crashed) the suppressed tabs re-elect once the claim
 * goes stale, and an explicit `release` sent on pagehide short-cuts that
 * timeout for orderly tab closes — the ring fails over instead of dying with
 * the tab. A `silence` message (the user dismissed the incoming-call toast
 * or widget) stops the noise in every tab without touching the visual
 * affordances.
 *
 * Suppression only spans tabs reachable through the transports in
 * `cross-tab-bus.ts`; where both are unavailable every tab rings, which is
 * the pre-election behavior.
 */

const RING_CHANNEL = 'macro-call-ring';
const RING_STORAGE_KEY = 'macro.call-ring';

/** How often the audible tab re-publishes (heartbeats) its claim. */
const CLAIM_HEARTBEAT_INTERVAL_MS = 1_000;
/**
 * A claim not re-published within this window is considered dead. Generous
 * enough to ride out background-tab timer throttling and to let an answered
 * call's resolution arrive (answering stops the heartbeat immediately, but
 * the `answered` resolution needs a server round-trip) before suppressed
 * tabs mistake the winner's silence for a crash.
 */
const CLAIM_TTL_MS = 3_500;
/**
 * Minimum gap between defensive re-publishes. A live audible tab whose
 * heartbeats got throttled can be mistaken for dead and see a takeover
 * claim; it immediately re-asserts its claim so the usurper stands down,
 * rate-limited so dueling tabs cannot flood the channel.
 */
const CLAIM_DEFENSE_MIN_INTERVAL_MS = 250;
const MAX_TRACKED_CALLS = 50;
const MAX_SILENCED_CALLS = 100;

type RingClaimMessage = {
  type: 'claim';
  callId: string;
  tabId: string;
  /** Election key — stable across every heartbeat of one claim. */
  claimedAt: number;
  /** Whether this tab can actually make noise (see `isAudioLikelyBlocked`). */
  audible: boolean;
  /**
   * Publish time. Not part of the election; it makes each heartbeat's
   * payload unique so the storage fallback fires (see `cross-tab-bus.ts`).
   */
  sentAt: number;
};

type RingSilenceMessage = { type: 'silence'; callId: string; sentAt: number };

type RingReleaseMessage = {
  type: 'release';
  callId: string;
  tabId: string;
  sentAt: number;
};

type RingMessage = RingClaimMessage | RingSilenceMessage | RingReleaseMessage;

function parseRingMessage(value: unknown): RingMessage | null {
  return match(value)
    .with(
      {
        type: 'claim',
        callId: P.string,
        tabId: P.string,
        claimedAt: P.number,
        audible: P.boolean,
        sentAt: P.number,
      },
      ({ type, callId, tabId, claimedAt, audible, sentAt }) => ({
        type,
        callId,
        tabId,
        claimedAt,
        audible,
        sentAt,
      })
    )
    .with(
      { type: 'silence', callId: P.string, sentAt: P.number },
      ({ type, callId, sentAt }) => ({ type, callId, sentAt })
    )
    .with(
      { type: 'release', callId: P.string, tabId: P.string, sentAt: P.number },
      ({ type, callId, tabId, sentAt }) => ({ type, callId, tabId, sentAt })
    )
    .otherwise(() => null);
}

// Handlers are idempotent on repeat delivery and heartbeats must not be
// deduped, so the bus is created without a message key.
const ringBus = createCrossTabBus<RingMessage>({
  channelName: RING_CHANNEL,
  storageKey: RING_STORAGE_KEY,
  parse: parseRingMessage,
});

const tabId: string =
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type TrackedClaim = {
  tabId: string;
  claimedAt: number;
  audible: boolean;
  /** Last time any publish of this claim was seen; drives staleness. */
  lastSeenAt: number;
};

export type RingParticipation = {
  /**
   * Ends this tab's participation without broadcasting anything: stops the
   * local ringer if it is the audible one and lets sibling tabs take the
   * ring over (via claim staleness) while the call is still unresolved. For
   * an explicit user dismissal use `silenceIncomingCallRing` instead.
   */
  stop: () => void;
};

export type RingParticipationOptions = {
  callId: string;
  /** Mirrors the ringer's stop condition (e.g. the user joined the call). */
  shouldStop: () => boolean;
  /**
   * Participation ends unconditionally this long after it starts, so a
   * takeover cannot outlive the original ring window.
   */
  maxDurationMs: number;
  /** Own the audible sound until release; call end when it stops itself. */
  ring: (end: () => void) => Cleanup;
  /** Called exactly once when the participation ends, whatever the cause. */
  onEnd?: () => void;
};

type RingState =
  | { t: 'suppressed' }
  | { t: 'audible'; claim: { claimedAt: number; audible: boolean } }
  | { t: 'ended' };
type RingEvent =
  | { t: 'acquire'; claim: { claimedAt: number; audible: boolean } }
  | { t: 'suppress' | 'end' };

const ringDefinition: MachineDef<RingState, RingEvent> = {
  suppressed: {
    on: (_state, event) =>
      match(event)
        .with({ t: 'acquire' }, ({ claim }) => ({
          state: { t: 'audible', claim } as const,
        }))
        .with({ t: 'end' }, () => ({ state: { t: 'ended' } as const }))
        .with({ t: 'suppress' }, () => undefined)
        .exhaustive(),
  },
  audible: {
    on: (_state, event) =>
      match(event)
        .with({ t: 'suppress' }, () => ({
          state: { t: 'suppressed' } as const,
        }))
        .with({ t: 'end' }, () => ({ state: { t: 'ended' } as const }))
        .with({ t: 'acquire' }, () => undefined)
        .exhaustive(),
  },
  ended: { on: () => undefined },
};

type Participation = {
  callId: string;
  options: RingParticipationOptions;
  machine: Machine<RingState, RingEvent>;
  deadline: number;
  lastDefendedAt: number;
};

const trackedClaims = new Map<string, TrackedClaim>();
const silencedCallIds = new Set<string>();
const participations = new Map<string, Participation>();

/**
 * Whether audio playback is likely blocked by the browser's autoplay policy.
 * A tab the user has never interacted with (opened in the background and
 * never focused) typically cannot start an AudioContext, so its ring would
 * be silent. Treated as capable when the API is unavailable.
 */
function isAudioLikelyBlocked(): boolean {
  if (typeof navigator === 'undefined') return false;
  const { userActivation } = navigator as Navigator & {
    userActivation?: { hasBeenActive?: boolean };
  };
  return userActivation ? userActivation.hasBeenActive === false : false;
}

/** Negative when `a` outranks `b`. Total order: audible, oldest, tab id. */
function compareClaims(
  a: { audible: boolean; claimedAt: number; tabId: string },
  b: { audible: boolean; claimedAt: number; tabId: string }
): number {
  if (a.audible !== b.audible) return a.audible ? -1 : 1;
  if (a.claimedAt !== b.claimedAt) return a.claimedAt - b.claimedAt;
  return a.tabId < b.tabId ? -1 : a.tabId > b.tabId ? 1 : 0;
}

function getLiveClaim(callId: string, now: number): TrackedClaim | undefined {
  const claim = trackedClaims.get(callId);
  if (!claim) return undefined;
  if (now - claim.lastSeenAt > CLAIM_TTL_MS) return undefined;
  // Never treat this tab's own residue as a live competitor.
  if (claim.tabId === tabId) return undefined;
  return claim;
}

function invokeCallback(callback: (() => void) | undefined, label: string) {
  try {
    callback?.();
  } catch (error) {
    console.error(`Ring participation ${label} callback failed`, error);
  }
}

function publishClaim(participation: Participation, now: number) {
  const state = participation.machine.getState();
  if (state.t !== 'audible') return;
  const { claim } = state;
  trackedClaims.set(participation.callId, {
    tabId,
    claimedAt: claim.claimedAt,
    audible: claim.audible,
    lastSeenAt: now,
  });
  evictOldest(trackedClaims, MAX_TRACKED_CALLS);
  ringBus.publish({
    type: 'claim',
    callId: participation.callId,
    tabId,
    claimedAt: claim.claimedAt,
    audible: claim.audible,
    sentAt: now,
  });
}

function acquire(participation: Participation, now: number) {
  participation.machine.dispatch({
    t: 'acquire',
    claim: { claimedAt: now, audible: !isAudioLikelyBlocked() },
  });
}

function demote(participation: Participation) {
  participation.machine.dispatch({ t: 'suppress' });
}

function endParticipation(participation: Participation) {
  participation.machine.dispatch({ t: 'end' });
}

function finishParticipation(participation: Participation) {
  if (participations.get(participation.callId) === participation)
    participations.delete(participation.callId);
  if (trackedClaims.get(participation.callId)?.tabId === tabId)
    trackedClaims.delete(participation.callId);
  invokeCallback(participation.options.onEnd, 'onEnd');
}

/**
 * Claims the ring if this tab would win the election against the best claim
 * currently known to be live; stays suppressed otherwise.
 */
function maybeClaim(participation: Participation, now: number) {
  const best = getLiveClaim(participation.callId, now);
  if (
    best &&
    compareClaims(best, {
      tabId,
      claimedAt: now,
      audible: !isAudioLikelyBlocked(),
    }) < 0
  ) {
    return;
  }
  acquire(participation, now);
}

function tick(participation: Participation) {
  const now = Date.now();
  if (
    now >= participation.deadline ||
    silencedCallIds.has(participation.callId) ||
    participation.options.shouldStop()
  ) {
    endParticipation(participation);
    return;
  }

  if (participation.machine.getState().t === 'audible') {
    publishClaim(participation, now);
  } else {
    maybeClaim(participation, now);
  }
}

function handleClaimMessage(message: RingClaimMessage) {
  if (message.tabId === tabId) return;
  const now = Date.now();

  const existing = trackedClaims.get(message.callId);
  const incoming: TrackedClaim = {
    tabId: message.tabId,
    claimedAt: message.claimedAt,
    audible: message.audible,
    lastSeenAt: now,
  };
  // Track the incoming claim when it is the first one seen, supersedes the
  // sender's own earlier claim (heartbeats included), replaces an expired
  // claim, or outranks the current one.
  if (
    !existing ||
    existing.tabId === incoming.tabId ||
    now - existing.lastSeenAt > CLAIM_TTL_MS ||
    compareClaims(incoming, existing) < 0
  ) {
    trackedClaims.set(message.callId, incoming);
    evictOldest(trackedClaims, MAX_TRACKED_CALLS);
  }

  const participation = participations.get(message.callId);
  const state = participation?.machine.getState();
  if (!participation || state?.t !== 'audible') return;
  const ownClaim = state.claim;

  if (compareClaims(incoming, { tabId, ...ownClaim }) < 0) {
    demote(participation);
    return;
  }

  // A losing claim while we ring is a takeover attempt from a tab that
  // mistook us for dead (e.g. our heartbeats got throttled). Re-assert the
  // claim immediately so the usurper stands down.
  if (now - participation.lastDefendedAt >= CLAIM_DEFENSE_MIN_INTERVAL_MS) {
    participation.lastDefendedAt = now;
    publishClaim(participation, now);
  }
}

function handleSilenceMessage(message: RingSilenceMessage) {
  silencedCallIds.add(message.callId);
  evictOldest(silencedCallIds, MAX_SILENCED_CALLS);
  const participation = participations.get(message.callId);
  if (participation) endParticipation(participation);
}

function handleReleaseMessage(message: RingReleaseMessage) {
  if (trackedClaims.get(message.callId)?.tabId === message.tabId) {
    trackedClaims.delete(message.callId);
  }
  const participation = participations.get(message.callId);
  if (participation && participation.machine.getState().t === 'suppressed') {
    maybeClaim(participation, Date.now());
  }
}

function handleRingMessage(message: RingMessage) {
  match(message)
    .with({ type: 'claim' }, handleClaimMessage)
    .with({ type: 'silence' }, handleSilenceMessage)
    .with({ type: 'release' }, handleReleaseMessage)
    .exhaustive();
}

function handlePageHide() {
  // Orderly tab close: hand the ring to a surviving tab immediately instead
  // of making it wait out the claim TTL. Participations are also ended so a
  // page restored from the back/forward cache does not resume a stale ring.
  for (const participation of [...participations.values()]) {
    if (participation.machine.getState().t === 'audible') {
      ringBus.publish({
        type: 'release',
        callId: participation.callId,
        tabId,
        sentAt: Date.now(),
      });
    }
    endParticipation(participation);
  }
}

let isRingCoordinationAttached = false;

/**
 * Attaches the cross-tab listeners once for the lifetime of the tab. The
 * APIs below call it lazily, but call it at app mount (`CallStartedNotifier`
 * does) so sibling tabs' claims are already recorded by the time this tab's
 * own `call_started` event arrives.
 */
export function attachRingCoordination() {
  if (isRingCoordinationAttached || typeof window === 'undefined') return;
  isRingCoordinationAttached = true;
  ringBus.subscribe(handleRingMessage);
  window.addEventListener('pagehide', handlePageHide);
}

/**
 * Joins the cross-tab election for ringing `callId`. The ring scope owns
 * sound while this tab is audible and cleans it up on release; a
 * suppressed participant stays ready to take the ring over until the call
 * resolves, the ring is silenced, or `maxDurationMs` elapses.
 */
export function participateInRing(
  options: RingParticipationOptions
): RingParticipation {
  attachRingCoordination();

  const existing = participations.get(options.callId);
  if (existing) endParticipation(existing);

  // Silenced or already-stopped calls never acquire resources.
  if (silencedCallIds.has(options.callId) || options.shouldStop()) {
    invokeCallback(options.onEnd, 'onEnd');
    return { stop: () => {} };
  }

  const now = Date.now();
  const deadline = now + options.maxDurationMs;
  const watch = () => {
    const interval = window.setInterval(
      () => tick(participation),
      CLAIM_HEARTBEAT_INTERVAL_MS
    );
    // Keep the original deadline across promotion/demotion, including between ticks.
    const timeout = window.setTimeout(
      () => endParticipation(participation),
      Math.max(0, deadline - Date.now())
    );
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  };
  const participation: Participation = {
    callId: options.callId,
    options,
    deadline,
    lastDefendedAt: 0,
    machine: createMachine<RingState, RingEvent>({
      initial: { t: 'suppressed' },
      def: ringDefinition,
      scopes: {
        suppressed: watch,
        audible: () => {
          const unwatch = watch();
          publishClaim(participation, Date.now());
          let active = true;
          let stop: Cleanup | undefined;
          try {
            stop = options.ring(() => {
              if (active) endParticipation(participation);
            });
          } catch (error) {
            console.error('Ring participation ring callback failed', error);
          }
          return () => {
            // A released sound may report that it stopped. That is not an end
            // request: suppressed tabs must remain eligible for takeover.
            active = false;
            unwatch();
            invokeCallback(stop, 'ring cleanup');
          };
        },
        ended: () => finishParticipation(participation),
      },
    }),
  };
  participations.set(options.callId, participation);
  maybeClaim(participation, now);

  return { stop: () => endParticipation(participation) };
}

/**
 * Silences the audible ringer for a call in every tab on this machine (the
 * user dismissed the incoming-call toast or widget). Visual affordances are
 * untouched — tabs keep their toasts and widgets; only the noise stops, and
 * no tab takes the ring over afterwards. Ringing on other devices is
 * unaffected; that resolves through call resolutions instead.
 */
export function silenceIncomingCallRing(callId: string) {
  attachRingCoordination();
  ringBus.publish({ type: 'silence', callId, sentAt: Date.now() });
}

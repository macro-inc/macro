/**
 * Guards for the automatic rejoin that runs after LiveKit gives up on a
 * dropped call session.
 *
 * The rejoin is a *recovery* path: it exists so a brief network hiccup does
 * not dump the user out of a call they are still in. It must never be able to
 * *start* a call, because the join API (`GET /call/{channel_id}`) is a
 * get-or-create — rejoining a call that has since ended creates a brand-new
 * one and rings the whole channel.
 *
 * That is exactly what a sleeping laptop produces. Closing the lid mid-call
 * freezes the page: LiveKit's socket dies, the server reaps the participant
 * and archives the call, and the pending rejoin timer sits frozen. On wake —
 * possibly the next day — the timer fires immediately (or LiveKit reports the
 * disconnect it could not report while suspended) and the "reconnect" starts a
 * fresh call in the channel with no user action at all.
 *
 * Two checks close that hole: a wall-clock check that the rejoin is running
 * when it was meant to, and a server check that the call being rejoined is
 * still the live call in that channel.
 */

/** Delay between the disconnect and the rejoin attempt. */
export const AUTO_REJOIN_DELAY_MS = 750;

/**
 * Wall-clock budget for the scheduled rejoin to actually run. A busy main
 * thread overshoots the timer by a little; a suspended device overshoots it by
 * minutes or hours, which is the signal that the session is long gone.
 */
export const AUTO_REJOIN_MAX_SCHEDULING_LAG_MS = 10_000;

/** Why an auto-rejoin was refused. */
export type AutoRejoinRefusal =
  /** The timer fired far later than scheduled — the device was suspended. */
  | 'device_suspended'
  /** The hook now tracks a different channel than the one that dropped. */
  | 'channel_changed'
  /** No call is running in the channel any more. */
  | 'call_ended'
  /** A different call is running now; this session's call is over. */
  | 'call_replaced'
  /** The dropped call could not be identified, so no rejoin can be proven safe. */
  | 'call_unknown'
  /** The active-call lookup failed, so we cannot prove a call still exists. */
  | 'lookup_failed';

/** A scheduled rejoin, captured at the moment the session dropped. */
export type AutoRejoinAttempt = {
  channelId: string;
  /**
   * The call the session was in when it dropped, or null when it could not be
   * determined. A null id refuses the rejoin: without it there is no way to
   * tell the dropped call apart from one someone else has since started, and
   * joining that would be as unprompted as creating one.
   */
  callId: string | null;
  /**
   * `Date.now()` when the rejoin was scheduled. Deliberately wall-clock, not
   * `performance.now()`: the performance timeline freezes while the device
   * sleeps, so a monotonic delta cannot reveal the suspension this exists to
   * detect.
   */
  scheduledAt: number;
};

/** The channel's live call, `null` when there is none, `'unavailable'` when the lookup failed. */
export type ActiveCallLookup = { callId: string } | null | 'unavailable';

/**
 * Checks that the rejoin is running when it was scheduled to, and still for
 * the channel that dropped. Runs before the active-call lookup so a rejoin
 * woken from suspension never reaches the network.
 */
export function checkAutoRejoinTiming(params: {
  attempt: AutoRejoinAttempt;
  now: number;
  currentChannelId: string;
}): AutoRejoinRefusal | null {
  const elapsed = params.now - params.attempt.scheduledAt;
  // A backwards clock jump is as untrustworthy as an overshoot.
  if (elapsed < 0 || elapsed > AUTO_REJOIN_MAX_SCHEDULING_LAG_MS) {
    return 'device_suspended';
  }
  if (params.currentChannelId !== params.attempt.channelId) {
    return 'channel_changed';
  }
  return null;
}

/**
 * Checks the dropped session's call against what the server reports is live in
 * the channel. Anything short of "the same call is still running" refuses, so
 * the rejoin can only ever re-enter an existing call.
 */
export function checkAutoRejoinTarget(params: {
  attempt: AutoRejoinAttempt;
  activeCall: ActiveCallLookup;
}): AutoRejoinRefusal | null {
  if (params.activeCall === 'unavailable') return 'lookup_failed';
  if (params.activeCall === null) return 'call_ended';
  if (params.attempt.callId === null) return 'call_unknown';
  if (params.activeCall.callId !== params.attempt.callId) {
    return 'call_replaced';
  }
  return null;
}

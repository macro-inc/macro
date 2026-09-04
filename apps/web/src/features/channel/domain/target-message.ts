import type { MachineDef, Transition } from '@macro-inc/machine';

/**
 * Target-message navigation (deep link / click-to-message) as a state machine.
 *
 * Pure: no solid-js, no timers, no cache. The runner in
 * `../Channel/create-target-message-controller.ts` owns the flash timer, the
 * readiness memo, and cache restoration. This module owns every decision
 * about what a navigation means.
 *
 * Lifecycle:  navigate → targeting → flashing → idle
 *
 * Only occurrences change state: a navigation, a scroll acknowledgement from
 * ChannelThread, the flash timer, a release, a reset. Whether the ThreadList
 * is *ready* (navigation handle present, initial scroll done, target in the
 * loaded window) is a condition over inputs the runner owns, so it is not a
 * state — it is passed into the selectors that depend on it.
 *
 * The ChannelThread contract this encodes (Channel.tsx derives ChannelThread's
 * props from `pendingScrollTargetId` and `pendingTargetReplyId`):
 *
 * - A root-only target (`replyId` absent) is positioned by ChannelThread as
 *   soon as it sees `pendingScrollTargetId`, and acked with `root-scroll-done`.
 * - A nested target (`replyId` present) must not scroll the whole row first.
 *   ChannelThread scrolls the reply's measured element only once
 *   `pendingScrollTargetId` clears while `pendingTargetReplyId` is set. That
 *   clearing is readiness itself, so the reply scroll is the only viewport
 *   movement, and ChannelThread never acks the root row of a nested target.
 *
 * `loadAround` is pagination context, not control state: it selects which
 * messages query Channel.tsx reads from and survives highlight release so
 * pagination isn't disturbed. Only `reset` and a successful restore clear it.
 * The restore is issued when the scroll is acknowledged — the one occurrence
 * at which the row is guaranteed mounted and the around data present.
 */

export type Target = {
  readonly messageId: string;
  readonly replyId?: string | undefined;
};

type WithLoadAround = { readonly loadAround: string | undefined };

export type State = WithLoadAround &
  (
    | { readonly t: 'idle' }
    /** Navigated; the target's scroll has not been acknowledged. */
    | { readonly t: 'targeting'; readonly target: Target }
    /** Positioned. Highlight is showing; released when the flash elapses. */
    | { readonly t: 'flashing'; readonly target: Target }
  );

export type Event =
  /**
   * `targetLoaded`: the message is already in the loaded window.
   * `ready`: the ThreadList is ready for the *current* target (see runner);
   * needed only for the dedupe rule, which mirrors `pendingScrollTargetId`.
   */
  | {
      readonly t: 'navigate';
      readonly target: Target;
      readonly targetLoaded: boolean;
      readonly ready: boolean;
    }
  | { readonly t: 'root-scroll-done'; readonly messageId: string }
  | {
      readonly t: 'reply-scroll-done';
      readonly messageId: string;
      readonly replyId: string;
    }
  | { readonly t: 'flash-elapsed' }
  /** The around-query's data was promoted to the default query. */
  | { readonly t: 'pagination-restored' }
  /** Release the highlight if it still points at `messageId`; leaves `loadAround` alone. */
  | { readonly t: 'release'; readonly messageId: string }
  /** Channel changed. Clears everything including `loadAround`. */
  | { readonly t: 'reset' };

export type Command = {
  readonly t: 'restore-default-pagination';
  readonly loadAround: string;
};

type Result = Transition<State, Command> | undefined;

const RESET: Transition<State, Command> = {
  state: { t: 'idle', loadAround: undefined },
};

function navigate(s: State, e: Extract<Event, { t: 'navigate' }>): Result {
  return {
    state: {
      t: 'targeting',
      target: e.target,
      // A target already inside the loaded window keeps the current around
      // anchor, so a rapid second navigation doesn't re-center pagination
      // while the first around-query is still in flight. This was a
      // documented hack; it is now a table row with a test.
      loadAround: e.targetLoaded ? s.loadAround : e.target.messageId,
    },
  };
}

/** Scroll acknowledged: flash, and promote the around window if one is anchored. */
function flash(s: Extract<State, { t: 'targeting' }>): Result {
  return {
    state: { t: 'flashing', target: s.target, loadAround: s.loadAround },
    commands:
      s.loadAround === undefined
        ? []
        : [{ t: 'restore-default-pagination', loadAround: s.loadAround }],
  };
}

function release(s: State): Result {
  return { state: { t: 'idle', loadAround: s.loadAround } };
}

function clearLoadAround(s: State): Result {
  return { state: { ...s, loadAround: undefined } };
}

const isSameTarget = (a: Target, b: Target) =>
  a.messageId === b.messageId && a.replyId === b.replyId;

const isRoot = (t: Target) => t.replyId === undefined;

export const targetMessageDef: MachineDef<State, Event, Command> = {
  idle: {
    on: (s, e) => {
      switch (e.t) {
        case 'navigate':
          return navigate(s, e);
        case 'pagination-restored':
          return clearLoadAround(s);
        case 'reset':
          return RESET;
        default:
          return undefined;
      }
    },
  },

  targeting: {
    on: (s, e) => {
      switch (e.t) {
        case 'navigate':
          return isSameTarget(s.target, e.target) &&
            pendingScrollTargetId(s, e.ready) !== undefined
            ? undefined
            : navigate(s, e);

        case 'root-scroll-done':
          return isRoot(s.target) && e.messageId === s.target.messageId
            ? flash(s)
            : undefined;

        case 'reply-scroll-done':
          return e.messageId === s.target.messageId &&
            e.replyId === s.target.replyId
            ? flash(s)
            : undefined;

        case 'pagination-restored':
          return clearLoadAround(s);
        case 'release':
          return e.messageId === s.target.messageId ? release(s) : undefined;
        case 'reset':
          return RESET;
        default:
          return undefined;
      }
    },
  },

  flashing: {
    on: (s, e) => {
      switch (e.t) {
        case 'navigate':
          return navigate(s, e);
        case 'flash-elapsed':
          return release(s);
        case 'pagination-restored':
          return clearLoadAround(s);
        case 'release':
          return e.messageId === s.target.messageId ? release(s) : undefined;
        case 'reset':
          return RESET;
        default:
          return undefined;
      }
    },
  },
};

export function initialState(init: {
  readonly messageId?: string | undefined;
  readonly replyId?: string | undefined;
}): State {
  if (init.messageId === undefined) return { t: 'idle', loadAround: undefined };
  return {
    t: 'targeting',
    target: { messageId: init.messageId, replyId: init.replyId },
    loadAround: init.messageId,
  };
}

export const activeTargetMessageId = (s: State): string | undefined =>
  s.t === 'idle' ? undefined : s.target.messageId;

export const activeTargetMessageReplyId = (s: State): string | undefined =>
  s.t === 'idle' ? undefined : s.target.replyId;

/**
 * The root row ChannelThread should position, if any. A root-only target is
 * pending until acknowledged. A nested target's root row is pending only
 * until the ThreadList is ready; readiness clears it so the reply scroll can
 * begin.
 */
export const pendingScrollTargetId = (
  s: State,
  ready: boolean
): string | undefined =>
  s.t === 'targeting' && (isRoot(s.target) || !ready)
    ? s.target.messageId
    : undefined;

/** The reply ChannelThread should position once the root row clears. */
export const pendingTargetReplyId = (s: State): string | undefined =>
  s.t === 'targeting' ? s.target.replyId : undefined;

/** Any scroll still owed to the target (root or reply). Used by Channel.tsx for keep-mounted. */
export const hasPendingElementScroll = (s: State, ready: boolean): boolean =>
  pendingScrollTargetId(s, ready) !== undefined ||
  pendingTargetReplyId(s) !== undefined;

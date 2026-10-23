import { fireAndForget } from '@core/util/fireAndForget';
import { thrownResultErrorHasCode } from '@core/util/result';
import {
  type Cleanup,
  createMachine,
  type MachineDef,
} from '@macro-inc/machine';
import type { CallTokenResponse } from '@service-call/client';
import type { DisconnectReason } from 'livekit-client';
import { match } from 'ts-pattern';
import {
  type ActiveCallLookup,
  AUTO_REJOIN_DELAY_MS,
  type AutoRejoinAttempt,
  checkAutoRejoinTarget,
  checkAutoRejoinTiming,
} from './auto-rejoin';
import type { CallSessionDisconnectOptions } from './CallSessionController';
import { LK_DISCONNECT_REASON } from './livekit-loader';

export const JOIN_TIMEOUT_MS = 15_000;
export const LEAVE_TIMEOUT_MS = 10_000;
/**
 * How many times a native session still reporting a call the user left is
 * ended before the lifecycle stops trying, so a native layer that never
 * reports the end cannot spin the leave loop.
 */
const MAX_ENDED_CALL_RELEASES = 2;
const ALREADY_IN_CALL_MESSAGE =
  "You're already in another call. Leave your current call before joining a new one.";
export type CallIdentity = { channelId: string; callId: string | null };
/** What started a join, recorded with the joined event. */
export type JoinSource =
  /** A Join control the user pressed. */
  | 'user'
  /** A `join_call` deep link: an answered ring or a notification tap. */
  | 'deep_link'
  /** A native session restored while its old leave was settling. */
  | 'restore'
  /** Recovery after the transport dropped. */
  | 'auto_rejoin';
/** Why a leave ran, recorded with the left event. */
export type LeaveReason =
  /** The user pressed Leave in the app. */
  | 'user_initiated'
  /** The native call ended: its End button, CallKit, or the server. */
  | 'native_ended'
  /** Cleanup for a join that native cancelled before it connected. */
  | 'join_cancelled'
  /** A native session still reporting a call the user already left. */
  | 'stale_native_session';

function sameCall(first: CallIdentity | undefined, second: CallIdentity) {
  return (
    first?.channelId === second.channelId &&
    first.callId?.toLowerCase() === second.callId?.toLowerCase()
  );
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
type Join = ReturnType<typeof deferred<void>> & {
  channelId: string;
  source: JoinSource;
  onJoin?: () => void;
  restoredCall?: CallIdentity;
};
type LeaveResult = { callEnded: boolean } | void;
type Leave = ReturnType<typeof deferred<LeaveResult>> & {
  channelId: string;
  /** The call being left, captured when the leave was requested. */
  call: CallIdentity;
  reason: LeaveReason;
  startedAt: number;
  options?: CallSessionDisconnectOptions;
  skipServerLeave?: boolean;
};
export type CallLifecycleState =
  | { t: 'idle' }
  | { t: 'joining'; request: Join }
  | { t: 'active'; call: CallIdentity }
  | { t: 'retry-wait'; attempt: AutoRejoinAttempt }
  | { t: 'checking'; attempt: AutoRejoinAttempt }
  | { t: 'leaving'; request: Leave }
  | { t: 'failed'; channelId: string; error: unknown };
type Event =
  | { t: 'join'; request: Join }
  | { t: 'leave'; request: Leave }
  | { t: 'connected' | 'adopt'; call: CallIdentity }
  | { t: 'disconnected'; retry: boolean; at: number }
  | { t: 'fail'; error: unknown }
  | { t: 'retry' | 'finish' };

const definition: MachineDef<CallLifecycleState, Event> = {
  idle: { on: (_state, event) => changeIntent(event) },
  joining: {
    on: (state, event) =>
      match(event)
        .with({ t: 'connected' }, ({ call }) => ({
          state: { t: 'active', call } as const,
        }))
        .with({ t: 'fail' }, ({ error }) => ({
          state: {
            t: 'failed',
            channelId: state.request.channelId,
            error,
          } as const,
        }))
        .with({ t: 'leave' }, ({ request }) => ({
          state: { t: 'leaving', request } as const,
        }))
        .otherwise(() => undefined),
  },
  active: {
    on: (state, event) =>
      match(event)
        .with({ t: 'disconnected' }, ({ retry, at }) => ({
          state: retry
            ? ({
                t: 'retry-wait',
                attempt: { ...state.call, scheduledAt: at },
              } as const)
            : ({ t: 'idle' } as const),
        }))
        .with({ t: 'adopt' }, ({ call }) =>
          sameCall(state.call, call)
            ? undefined
            : { state: { t: 'active', call } as const }
        )
        .otherwise(() => changeIntent(event)),
  },
  'retry-wait': {
    on: (state, event) =>
      event.t === 'retry'
        ? { state: { t: 'checking', attempt: state.attempt } }
        : changeIntent(event),
  },
  checking: { on: (_state, event) => changeIntent(event) },
  leaving: {
    on: (state, event) =>
      match(event)
        .with({ t: 'finish' }, changeIntent)
        .with({ t: 'adopt' }, ({ call }) =>
          state.request.options?.endNativeCall === false &&
          state.request.channelId === call.channelId
            ? changeIntent(event)
            : undefined
        )
        .with({ t: 'join' }, ({ request }) =>
          state.request.options?.endNativeCall === false &&
          state.request.channelId === request.channelId
            ? changeIntent(event)
            : undefined
        )
        .otherwise(() => undefined),
  },
  failed: { on: (_state, event) => changeIntent(event) },
};

function changeIntent(event: Event) {
  return match(event)
    .with({ t: 'join' }, ({ request }) => ({
      state: { t: 'joining', request } as const,
    }))
    .with({ t: 'leave' }, ({ request }) => ({
      state: { t: 'leaving', request } as const,
    }))
    .with({ t: 'adopt' }, ({ call }) => ({
      state: { t: 'active', call } as const,
    }))
    .with({ t: 'finish' }, () => ({ state: { t: 'idle' } as const }))
    .otherwise(() => undefined);
}

function shouldRejoin(reason?: DisconnectReason) {
  return match(reason)
    .with(
      LK_DISCONNECT_REASON.CLIENT_INITIATED,
      LK_DISCONNECT_REASON.DUPLICATE_IDENTITY,
      LK_DISCONNECT_REASON.PARTICIPANT_REMOVED,
      LK_DISCONNECT_REASON.ROOM_DELETED,
      LK_DISCONNECT_REASON.ROOM_CLOSED,
      () => false
    )
    .otherwise(() => true);
}

/** One coordinator per call provider; views only submit intent and observe it. */
export function createCallLifecycle(options: {
  shouldRequestToken: (channelId: string) => boolean;
  prepareToken?: (channelId: string) => Promise<() => Promise<void>>;
  requestToken: (channelId: string) => Promise<CallTokenResponse>;
  connect: (token: CallTokenResponse) => Promise<void>;
  disconnect: (options?: CallSessionDisconnectOptions) => Promise<void>;
  leave: (channelId: string) => Promise<LeaveResult>;
  lookup: (channelId: string) => Promise<ActiveCallLookup>;
  currentCall: () => CallIdentity | undefined;
  beginJoin: (channelId: string) => void;
  rollbackJoin: () => void;
  setError: (error: string | null) => void;
  watch: (
    call: CallIdentity,
    disconnected: (reason?: DisconnectReason) => void,
    nativeEnded: () => void
  ) => Cleanup;
  onJoined: (call: CallIdentity, source: JoinSource) => void;
  onLeft: (call: CallIdentity, reason: LeaveReason) => void;
  reportError: (error: unknown) => void;
}) {
  let disposed = false;
  const pendingServerLeaves = new Set<Promise<unknown>>();
  // Calls this user left, by lowercase call id. A native session that still
  // reports one is a leftover to end, never a session to adopt or restore;
  // only an explicit join of the channel lets its call back in.
  const endedCalls = new Map<string, { channelId: string; releases: number }>();
  function markEnded(call: CallIdentity | undefined) {
    const key = call?.callId?.toLowerCase();
    if (!call || !key || endedCalls.has(key)) return;
    endedCalls.set(key, { channelId: call.channelId, releases: 0 });
  }
  function forgetEndedCalls(channelId: string) {
    for (const [key, ended] of endedCalls) {
      if (ended.channelId === channelId) endedCalls.delete(key);
    }
  }
  const endedCall = (call: CallIdentity) =>
    call.callId ? endedCalls.get(call.callId.toLowerCase()) : undefined;
  async function leaveServer(channelId: string) {
    const pending = options.leave(channelId);
    pendingServerLeaves.add(pending);
    try {
      return await pending;
    } finally {
      pendingServerLeaves.delete(pending);
    }
  }
  const leaveListeners = new Set<(channelId: string) => void>();
  const notifyLeft = (channelId: string) => {
    for (const listener of [...leaveListeners]) {
      try {
        listener(channelId);
      } catch (error) {
        options.reportError(error);
      }
    }
  };
  const machine = createMachine<CallLifecycleState, Event>({
    initial: { t: 'idle' },
    def: definition,
    scopes: {
      idle: () => {
        options.rollbackJoin();
        options.setError(null);
      },
      joining: ({ request }, dispatch) => {
        let active = true;
        let settled = false;
        let finishPreparation: (() => Promise<void>) | undefined;
        const releasePreparation = () => {
          const cleanup = finishPreparation;
          finishPreparation = undefined;
          if (cleanup) void cleanup().catch(options.reportError);
        };
        const fail = (error: unknown) => {
          if (!active) return;
          settled = true;
          request.reject(error);
          dispatch({ t: 'fail', error });
        };
        let timeout = setTimeout(
          () => fail(new Error('Connection timed out')),
          JOIN_TIMEOUT_MS
        );
        let finishDelay!: () => void;
        const delay = new Promise<void>((resolve) => {
          finishDelay = resolve;
        });
        const delayTimer = setTimeout(finishDelay, 300);
        options.beginJoin(request.channelId);
        async function connect() {
          try {
            request.onJoin?.();
            // A sent leave cannot be cancelled. Register the retry only after
            // it settles, so the old request cannot remove the new membership.
            const renewMembership = pendingServerLeaves.size > 0;
            if (renewMembership) {
              await Promise.allSettled(pendingServerLeaves);
              if (!active) return;
            }
            if (request.restoredCall) {
              let activeCall: ActiveCallLookup;
              try {
                activeCall = await options.lookup(request.channelId);
              } catch (error) {
                if (!active) return;
                options.reportError(error);
                activeCall = 'unavailable';
              }
              if (!active) return;
              if (
                checkAutoRejoinTarget({
                  attempt: { ...request.restoredCall, scheduledAt: Date.now() },
                  activeCall,
                })
              ) {
                await releaseStaleNativeSession(request.restoredCall, true);
                return;
              }
            }
            let call = options.currentCall();
            const needsConnection = options.shouldRequestToken(
              request.channelId
            );
            if (needsConnection || renewMembership) {
              if (options.prepareToken) {
                // Permission prompts precede the lease and connection deadline.
                clearTimeout(timeout);
                const cleanup = await options.prepareToken(request.channelId);
                if (!active) {
                  await cleanup();
                  return;
                }
                finishPreparation = cleanup;
                timeout = setTimeout(
                  () => fail(new Error('Connection timed out')),
                  JOIN_TIMEOUT_MS
                );
              }
              const [token] = await Promise.all([
                options.requestToken(request.channelId),
                delay,
              ]);
              if (!active) return;
              if (token.channelId !== request.channelId) {
                throw new Error(
                  'Call token does not belong to the requested channel'
                );
              }
              if (
                !needsConnection &&
                call &&
                !sameCall(call, {
                  channelId: token.channelId,
                  callId: token.callId,
                })
              ) {
                // The server ended the session native still reports. Release
                // the newly issued membership and the stale native session.
                await releaseStaleNativeSession(call);
                return;
              }
              if (needsConnection) await options.connect(token);
              call = { channelId: token.channelId, callId: token.callId };
            } else {
              // Let the joining scope finish mounting before dispatching its
              // completion, just as the token/connect path does.
              await Promise.resolve();
            }
            if (!active) return;
            options.rollbackJoin();
            options.setError(null);
            settled = true;
            request.resolve();
            const connected = call ?? {
              channelId: request.channelId,
              callId: null,
            };
            dispatch({ t: 'connected', call: connected });
            try {
              const current = machine.getState();
              if (current.t === 'active' && sameCall(current.call, connected))
                options.onJoined(connected, request.source);
            } catch (error) {
              options.reportError(error);
            }
          } catch (error) {
            fail(error);
          } finally {
            releasePreparation();
          }
        }
        fireAndForget(connect(), 'channel-call');
        return () => {
          active = false;
          releasePreparation();
          clearTimeout(timeout);
          clearTimeout(delayTimer);
          finishDelay();
          if (!settled) request.reject(new Error('Call join cancelled'));
        };
      },
      active: ({ call }, dispatch) => {
        options.setError(null);
        let active = true;
        const unwatch = options.watch(
          call,
          (reason) => {
            if (!active) return;
            const retry = shouldRejoin(reason);
            dispatch({ t: 'disconnected', retry, at: Date.now() });
            if (!retry) notifyLeft(call.channelId);
          },
          () => {
            if (active)
              fireAndForget(leaveEndedNativeCall(call), 'channel-call');
          }
        );
        return () => {
          active = false;
          unwatch();
        };
      },
      'retry-wait': ({ attempt }, dispatch) => {
        options.setError('Call disconnected. Reconnecting…');
        const timer = setTimeout(() => {
          // The session owns this channel even if the initiating view navigates.
          // A new join or leave exits the scope and cancels the recovery.
          const refusal = checkAutoRejoinTiming({
            attempt,
            now: Date.now(),
            currentChannelId: attempt.channelId,
          });
          if (refusal) {
            options.setError(null);
            dispatch({ t: 'finish' });
            notifyLeft(attempt.channelId);
          } else dispatch({ t: 'retry' });
        }, AUTO_REJOIN_DELAY_MS);
        return () => clearTimeout(timer);
      },
      checking: ({ attempt }, dispatch) => {
        let active = true;
        async function recover() {
          let activeCall: ActiveCallLookup;
          try {
            activeCall = await options.lookup(attempt.channelId);
          } catch (error) {
            if (!active) return;
            options.reportError(error);
            activeCall = 'unavailable';
          }
          if (!active) return;
          if (
            checkAutoRejoinTiming({
              attempt,
              now: Date.now(),
              currentChannelId: attempt.channelId,
            }) ||
            checkAutoRejoinTarget({ attempt, activeCall })
          ) {
            options.setError(null);
            dispatch({ t: 'finish' });
            notifyLeft(attempt.channelId);
            return;
          }
          try {
            await startJoin(attempt.channelId, 'auto_rejoin');
          } catch (error) {
            options.reportError(error);
          }
        }
        fireAndForget(recover(), 'channel-call');
        return () => {
          active = false;
        };
      },
      failed: ({ channelId, error }) => {
        options.rollbackJoin();
        options.setError(
          thrownResultErrorHasCode(error, 'CONFLICT')
            ? ALREADY_IN_CALL_MESSAGE
            : 'Unable to join the call. Please check your connection.'
        );
        let active = true;
        // Recovery must not keep Try again pending, or tear down a newer join.
        async function cleanUpFailedJoin() {
          try {
            await options.disconnect({ endNativeCall: false });
          } catch (error) {
            options.reportError(error);
          }
          if (!active) return;
          try {
            await leaveServer(channelId);
          } catch (error) {
            options.reportError(error);
          }
        }
        fireAndForget(cleanUpFailedJoin(), 'channel-call');
        return () => {
          active = false;
        };
      },
      leaving: ({ request }, dispatch) => {
        let active = true;
        let settled = false;
        // Leave the call surface immediately; media teardown may be slow or fail.
        notifyLeft(request.channelId);
        options.rollbackJoin();
        options.setError(null);
        const finish = (error?: unknown, result?: LeaveResult) => {
          if (!active) return;
          settled = true;
          if (error) request.reject(error);
          else request.resolve(result);
          dispatch({ t: 'finish' });
        };
        let serverLeave: Promise<LeaveResult> | undefined;
        const leaveServerOnce = () =>
          (serverLeave ??= leaveServer(request.channelId));
        const timeout = setTimeout(() => {
          // Media teardown hung, but the user still left: release the
          // membership now, so the server stops holding them in the call and
          // a later join waits for this leave instead of racing it.
          if (!request.skipServerLeave)
            fireAndForget(leaveServerOnce(), 'channel-call');
          finish(new Error('Leaving call timed out'));
        }, LEAVE_TIMEOUT_MS);
        async function disconnect() {
          let result: LeaveResult = undefined;
          try {
            try {
              await options.disconnect(request.options);
              if (!active) return;
              options.onLeft(request.call, request.reason);
            } finally {
              if (active && !request.skipServerLeave)
                result = await leaveServerOnce();
            }
            finish(undefined, result);
          } catch (error) {
            if (active) finish(error);
            else options.reportError(error);
          }
        }
        fireAndForget(disconnect(), 'channel-call');
        return () => {
          active = false;
          clearTimeout(timeout);
          if (!settled) {
            // Native end cleanup yields to a restored session or a new join.
            if (request.options?.endNativeCall === false) request.resolve();
            else request.reject(new Error('Call leave cancelled'));
          }
        };
      },
    },
  });

  /** Joins at the user's request, which lets a call they left back in. */
  function join(
    channelId: string,
    onJoin?: () => void,
    source: JoinSource = 'user'
  ): Promise<void> {
    return startJoin(channelId, source, onJoin, true);
  }

  function startJoin(
    channelId: string,
    source: JoinSource,
    onJoin?: () => void,
    explicit = false
  ): Promise<void> {
    if (disposed) return Promise.reject(new Error('Call lifecycle disposed'));
    const state = machine.getState();
    if (state.t === 'joining')
      return state.request.channelId === channelId
        ? state.request.promise
        : Promise.reject(new Error('Already joining another call'));
    if (
      state.t === 'leaving' &&
      (state.request.options?.endNativeCall !== false ||
        state.request.channelId !== channelId)
    )
      return Promise.reject(new Error('Call is still leaving'));
    if (state.t === 'active') {
      try {
        onJoin?.();
        if (state.call.channelId !== channelId) {
          options.setError(ALREADY_IN_CALL_MESSAGE);
          return Promise.reject(new Error(ALREADY_IN_CALL_MESSAGE));
        }
        options.setError(null);
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(error);
      }
    }
    // Only an accepted join lets a left call back in: a refused one (still
    // leaving, joining elsewhere) must keep it out once the leave settles.
    if (explicit) forgetEndedCalls(channelId);
    const request: Join = { ...deferred(), channelId, source, onJoin };
    machine.dispatch({ t: 'join', request });
    return request.promise;
  }

  /** The call a leave of this channel ends, as far as the lifecycle knows. */
  function callInChannel(channelId: string): CallIdentity {
    const call = match(machine.getState())
      .with({ t: 'active' }, ({ call }) => call)
      .with({ t: 'retry-wait' }, { t: 'checking' }, ({ attempt }) => attempt)
      .with({ t: 'leaving' }, ({ request }) => request.call)
      .otherwise(() => options.currentCall());
    return {
      channelId,
      callId: call?.channelId === channelId ? call.callId : null,
    };
  }

  /** Leaves at the user's request: the call is over for this user. */
  function leave(
    channelId: string,
    leaveOptions?: CallSessionDisconnectOptions
  ): Promise<LeaveResult> {
    const call = callInChannel(channelId);
    markEnded(call);
    return requestLeave(call, 'user_initiated', leaveOptions);
  }

  function requestLeave(
    call: CallIdentity,
    reason: LeaveReason,
    leaveOptions?: CallSessionDisconnectOptions
  ): Promise<LeaveResult> {
    if (disposed) return Promise.reject(new Error('Call lifecycle disposed'));
    const state = machine.getState();
    if (state.t === 'leaving') {
      // Timers can freeze in a suspended webview. A resumed tap must be able
      // to replace a stale leave even before its timeout callback runs.
      const elapsed = Date.now() - state.request.startedAt;
      if (elapsed >= 0 && elapsed < LEAVE_TIMEOUT_MS)
        return state.request.promise;
      machine.dispatch({ t: 'finish' });
    }
    return startLeave(call, reason, leaveOptions);
  }

  function startLeave(
    call: CallIdentity,
    reason: LeaveReason,
    leaveOptions?: CallSessionDisconnectOptions,
    skipServerLeave = false
  ) {
    const request: Leave = {
      ...deferred<LeaveResult>(),
      channelId: call.channelId,
      call,
      reason,
      startedAt: Date.now(),
      options: leaveOptions,
      skipServerLeave,
    };
    machine.dispatch({ t: 'leave', request });
    return request.promise;
  }

  async function leaveEndedNativeSession(
    channelId: string,
    reason: LeaveReason
  ) {
    try {
      await requestLeave(callInChannel(channelId), reason, {
        endNativeCall: false,
      });
    } catch (error) {
      options.reportError(error);
    }
  }

  async function leaveEndedNativeCall(call: CallIdentity) {
    // Native ended this call (its End button, CallKit, or the server), so it
    // is over for this user: a snapshot that still reports it afterwards is a
    // leftover to end, not a session to restore.
    markEnded(call);
    await leaveEndedNativeSession(call.channelId, 'native_ended');
  }

  async function releaseStaleNativeSession(
    call: CallIdentity,
    skipServerLeave = false
  ) {
    const current = options.currentCall();
    if (current?.channelId === call.channelId && !sameCall(current, call)) {
      // Another native session now owns this channel; its membership must stay.
      machine.dispatch({ t: 'connected', call: current });
      return;
    }
    try {
      await startLeave(
        call,
        'stale_native_session',
        {
          endNativeCall: sameCall(current, call),
        },
        skipServerLeave
      );
    } catch (error) {
      options.reportError(error);
    }
  }

  function releaseEndedNativeSession(call: CallIdentity) {
    const ended = endedCall(call);
    // A join or leave in flight owns the session, and a failed join's cleanup
    // must finish; the native binding re-reads the snapshot when they settle.
    if (!ended || machine.getState().t !== 'idle') return;
    if (ended.releases >= MAX_ENDED_CALL_RELEASES) return;
    ended.releases += 1;
    options.reportError(
      new Error(`Native call ${call.callId} still active after it ended`)
    );
    // The server membership is already gone, so only the native call ends.
    fireAndForget(endLeftoverNativeSession(call), 'channel-call');
  }

  async function endLeftoverNativeSession(call: CallIdentity) {
    try {
      await startLeave(
        call,
        'stale_native_session',
        { endNativeCall: true },
        true
      );
    } catch (error) {
      options.reportError(error);
    }
  }

  async function restoreAfterLeave(call: CallIdentity) {
    const request: Join = {
      ...deferred(),
      channelId: call.channelId,
      source: 'restore',
      restoredCall: call,
    };
    machine.dispatch({ t: 'join', request });
    try {
      await request.promise;
    } catch (error) {
      options.reportError(error);
    }
  }

  return {
    join,
    leave,
    getState: machine.getState,
    subscribe: machine.subscribe,
    syncSession: (call: CallIdentity | undefined) => {
      if (disposed) return;
      if (call) {
        if (endedCall(call)) {
          releaseEndedNativeSession(call);
          return;
        }
        const state = machine.getState();
        if (
          state.t === 'leaving' &&
          state.request.options?.endNativeCall === false &&
          state.request.channelId === call.channelId &&
          pendingServerLeaves.size > 0
        ) {
          // The native transport may already be restored, but the old DELETE
          // is still authoritative for membership until it settles.
          fireAndForget(restoreAfterLeave(call), 'channel-call');
          return;
        }
        machine.dispatch({ t: 'adopt', call });
        return;
      }
      const state = machine.getState();
      if (state.t === 'joining') {
        // Requesting a token can register a server participant before media
        // connects. Clean up unless a new session supersedes this attempt.
        fireAndForget(
          leaveEndedNativeSession(state.request.channelId, 'join_cancelled'),
          'channel-call'
        );
        return;
      }
      const channelId = match(state)
        .with({ t: 'active' }, ({ call }) => call.channelId)
        .with(
          { t: 'retry-wait' },
          { t: 'checking' },
          ({ attempt }) => attempt.channelId
        )
        .otherwise(() => undefined);
      if (channelId !== undefined) {
        machine.dispatch({ t: 'finish' });
        notifyLeft(channelId);
      }
    },
    onLeave: (listener: (channelId: string) => void) => {
      leaveListeners.add(listener);
      return () => {
        leaveListeners.delete(listener);
      };
    },
    dispose: () => {
      disposed = true;
      machine.dispose();
      leaveListeners.clear();
    },
  };
}

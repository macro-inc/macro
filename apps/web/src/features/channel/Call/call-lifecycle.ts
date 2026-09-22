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
const ALREADY_IN_CALL_MESSAGE =
  "You're already in another call. Leave your current call before joining a new one.";
export type CallIdentity = { channelId: string; callId: string | null };

function sameCall(first: CallIdentity | undefined, second: CallIdentity) {
  return (
    first?.channelId === second.channelId &&
    first.callId?.toLowerCase() === second.callId?.toLowerCase()
  );
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
type Join = ReturnType<typeof deferred> & {
  channelId: string;
  onJoin?: () => void;
  restoredCall?: CallIdentity;
};
type Leave = ReturnType<typeof deferred> & {
  channelId: string;
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
  requestToken: (channelId: string) => Promise<CallTokenResponse>;
  connect: (token: CallTokenResponse) => Promise<void>;
  disconnect: (options?: CallSessionDisconnectOptions) => Promise<void>;
  leave: (channelId: string) => Promise<unknown>;
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
  onJoined: (call: CallIdentity) => void;
  onLeft: (channelId: string) => void;
  reportError: (error: unknown) => void;
}) {
  let disposed = false;
  const pendingServerLeaves = new Set<Promise<unknown>>();
  async function leaveServer(channelId: string) {
    const pending = options.leave(channelId);
    pendingServerLeaves.add(pending);
    try {
      await pending;
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
        const fail = (error: unknown) => {
          if (!active) return;
          settled = true;
          request.reject(error);
          dispatch({ t: 'fail', error });
        };
        const timeout = setTimeout(
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
              const [token] = await Promise.all([
                options.requestToken(request.channelId),
                delay,
              ]);
              if (!active) return;
              if (!needsConnection && call && !sameCall(call, token)) {
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
                options.onJoined(connected);
            } catch (error) {
              options.reportError(error);
            }
          } catch (error) {
            fail(error);
          }
        }
        void connect();
        return () => {
          active = false;
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
            if (active) void leaveEndedNativeSession(call.channelId);
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
            await join(attempt.channelId);
          } catch (error) {
            options.reportError(error);
          }
        }
        void recover();
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
        void cleanUpFailedJoin();
        return () => {
          active = false;
        };
      },
      leaving: ({ request }, dispatch) => {
        let active = true;
        let settled = false;
        options.rollbackJoin();
        options.setError(null);
        const finish = (error?: unknown) => {
          if (!active) return;
          settled = true;
          if (error) request.reject(error);
          else request.resolve();
          dispatch({ t: 'finish' });
        };
        const timeout = setTimeout(
          () => finish(new Error('Leaving call timed out')),
          LEAVE_TIMEOUT_MS
        );
        async function disconnect() {
          try {
            try {
              await options.disconnect(request.options);
              if (!active) return;
              notifyLeft(request.channelId);
              options.onLeft(request.channelId);
            } finally {
              if (active && !request.skipServerLeave)
                await leaveServer(request.channelId);
            }
            finish();
          } catch (error) {
            if (active) finish(error);
            else options.reportError(error);
          }
        }
        void disconnect();
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

  function join(channelId: string, onJoin?: () => void): Promise<void> {
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
    const request: Join = { ...deferred(), channelId, onJoin };
    machine.dispatch({ t: 'join', request });
    return request.promise;
  }

  function leave(
    channelId: string,
    leaveOptions?: CallSessionDisconnectOptions
  ): Promise<void> {
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
    return startLeave(channelId, leaveOptions);
  }

  function startLeave(
    channelId: string,
    leaveOptions?: CallSessionDisconnectOptions,
    skipServerLeave = false
  ) {
    const request: Leave = {
      ...deferred(),
      channelId,
      startedAt: Date.now(),
      options: leaveOptions,
      skipServerLeave,
    };
    machine.dispatch({ t: 'leave', request });
    return request.promise;
  }

  async function leaveEndedNativeSession(channelId: string) {
    try {
      await leave(channelId, { endNativeCall: false });
    } catch (error) {
      options.reportError(error);
    }
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
        call.channelId,
        {
          endNativeCall: sameCall(current, call),
        },
        skipServerLeave
      );
    } catch (error) {
      options.reportError(error);
    }
  }

  async function restoreAfterLeave(call: CallIdentity) {
    const request: Join = {
      ...deferred(),
      channelId: call.channelId,
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
        const state = machine.getState();
        if (
          state.t === 'leaving' &&
          state.request.options?.endNativeCall === false &&
          state.request.channelId === call.channelId &&
          pendingServerLeaves.size > 0
        ) {
          // The native transport may already be restored, but the old DELETE
          // is still authoritative for membership until it settles.
          void restoreAfterLeave(call);
          return;
        }
        machine.dispatch({ t: 'adopt', call });
        return;
      }
      const state = machine.getState();
      if (state.t === 'joining') {
        // Requesting a token can register a server participant before media
        // connects. Clean up unless a new session supersedes this attempt.
        void leaveEndedNativeSession(state.request.channelId);
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

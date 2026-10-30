import { whenSplitManagerReady } from '@app/signal/splitLayout';
import { registerPushRegistrationLifecycle } from '@core/auth/push-registration-lifecycle';
import { ENABLE_CALLKIT } from '@core/constant/featureFlags';
import { useChannelsContext } from '@core/context/channels';
import { fireAndForget } from '@core/util/fireAndForget';
import { isPlatform } from '@core/util/platform';
import { useUserNamesQuery } from '@queries/auth';
import { invalidateActiveCallQueries } from '@queries/call/call';
import type { UserName } from '@service-auth/generated/schemas/userName';
import { raceTimeout } from '@solid-primitives/promise';
import { addPluginListener, Channel, invoke } from '@tauri-apps/api/core';
import { createEffect, createMemo, on, onCleanup, onMount } from 'solid-js';
import {
  registerVoipDevice,
  unregisterVoipDevice,
} from '../queries/voip-device-registration';
import { joinChannelCall } from './join-channel-call';
import { isNativeCallEnabled } from './native-call-platform';
import {
  type NativeCallSnapshot,
  type NativeCallState,
  useNativeCallState,
} from './native-call-state';
import { openChannelCallTab } from './open-channel-call-tab';
import { useCallKitThemeSync } from './use-callkit-theme-sync';

export { isNativeCallEnabled } from './native-call-platform';

async function getCachedVoipToken(): Promise<string | null> {
  const { token } = await invoke<{ token: string | null }>(
    'plugin:call-kit|get_voip_token'
  );
  return token;
}

async function registerVoipToken(token: string): Promise<void> {
  const res = await registerVoipDevice(token);
  if (res.isErr()) {
    // The client returns a Result and never rejects — throw so callers (and
    // the push lifecycle's retry) can see the failure.
    throw new Error(
      `failed to register VoIP token: ${res.error.map((e) => e.code).join(',')}`
    );
  }
}

/** Register the cached PushKit token (if any) under the current session's user. */
async function syncVoipRegistration(): Promise<void> {
  const token = await getCachedVoipToken();
  if (!token) return;
  console.info('[callkit] registering cached VoIP token', {
    tokenLength: token.length,
  });
  await registerVoipToken(token);
}

async function unregisterVoipForLogout(): Promise<void> {
  const token = await getCachedVoipToken();
  if (!token) return;
  const res = await unregisterVoipDevice(token);
  if (res.isErr()) {
    throw new Error(
      `failed to unregister VoIP token: ${res.error.map((e) => e.code).join(',')}`
    );
  }
}

type VoipTokenPayload = { token: string };
type CallAnsweredPayload = {
  channelId: string;
  nativeMedia?: boolean;
  callId?: string;
  /** When CallKit fulfilled the answer, epoch ms. */
  answeredAtMs?: number;
};
type CallEndedPayload = { callId: string };
type DrawerOpenedPayload = { channelId: string };
type ParticipantIdentitiesPayload = { identities: string[] };
type CallEndedHandler = (payload: CallEndedPayload) => void | Promise<void>;

type StartOutgoingCallArgs = {
  channelId: string;
  callId: string;
  channelTitle?: string | null;
  callerName?: string | null;
  serverUrl: string;
  token: string;
};

type ConnectionStatePayload = {
  state: NativeCallSnapshot['connectionState'];
  channelId: NativeCallSnapshot['channelId'] | null;
  callId: NativeCallSnapshot['callId'] | null;
  isAudioMuted?: NativeCallSnapshot['isAudioMuted'];
  isVideoMuted?: NativeCallSnapshot['isVideoMuted'];
  videoOverlayMode?: NativeCallSnapshot['videoOverlayMode'];
};

type GetActiveCallStateResponse = {
  state: (NativeCallSnapshot & { participantIdentities?: string[] }) | null;
};

type GetPendingAnsweredCallResponse = {
  channelId: string | null;
  nativeMedia?: boolean | null;
  callId?: string | null;
  answeredAtMs?: number | null;
};

/**
 * How old a CallKit answer can be when the webview handles it. Answers reach
 * JS late when the webview was suspended or cold-started; past this, the call
 * may already be over or left, and joining it would be unprompted.
 */
const ANSWERED_CALL_MAX_AGE_MS = 60_000;

/** One CallKit answer: its call when native names it, else its channel. */
function answeredCallIdentity(
  answer: Pick<CallAnsweredPayload, 'channelId' | 'nativeMedia' | 'callId'>
): string {
  return answer.callId
    ? `call:${answer.callId.toLowerCase()}`
    : `${answer.channelId}:${answer.nativeMedia ?? false}`;
}

type NativeCallChannelMetadata = {
  channelId: string;
  name?: string | null;
};

type NativeCallChannelTitleSyncValue =
  | { channelId: string; channelTitle: string }
  | null
  | undefined;

type NativeParticipantDisplayNames =
  | { isPending: true }
  | {
      isPending: false;
      displayNames: Record<string, string>;
      fetchedNameCount: number;
      errors: unknown[];
    };

/** Awaits `work`, logging a rejection under `message` instead of rethrowing. */
async function logFailure(work: Promise<unknown>, message: string) {
  try {
    await work;
  } catch (err) {
    console.error(message, err);
  }
}

/** Starts `work` without waiting for it, logging a rejection under `message`. */
function startLogged(work: Promise<unknown>, message: string) {
  fireAndForget(logFailure(work, message), 'callkit');
}

function refreshActiveCallQueriesAfterLeave() {
  startLogged(
    invalidateActiveCallQueries(),
    '[callkit] failed to refresh active call state'
  );
}

// Call setup has legitimate windows where JS already tracks a call but native
// reports none yet (answered call before the LiveKit session connects, the
// split-manager wait before a JS-driven join). syncNativeCallState must not
// mistake those for orphaned state, so every live call-state signal marks
// activity here and the destructive clear requires a quiet period first.
const NATIVE_CALL_STATE_CLEAR_QUIET_MS = 30_000;
let lastNativeCallActivityMs: number | null = null;

function markNativeCallActivity() {
  lastNativeCallActivityMs = Date.now();
}

function hasRecentNativeCallActivity(): boolean {
  if (lastNativeCallActivityMs === null) return false;
  const elapsed = Date.now() - lastNativeCallActivityMs;
  return elapsed >= 0 && elapsed < NATIVE_CALL_STATE_CLEAR_QUIET_MS;
}

function applyConnectionState(
  nativeCall: NativeCallState,
  payload: ConnectionStatePayload
) {
  console.info('[callkit] connection state channel message', payload);
  markNativeCallActivity();
  if (
    !payload.channelId ||
    !payload.callId ||
    payload.state === 'disconnected'
  ) {
    nativeCall.setBootstrapChannelId(null);
    nativeCall.setParticipantIdentities([]);
    nativeCall.setSnapshot(null);
    if (payload.state === 'disconnected') {
      refreshActiveCallQueriesAfterLeave();
    }
    return;
  }
  const snapshot: NativeCallSnapshot = {
    channelId: payload.channelId,
    callId: payload.callId,
    connectionState: payload.state,
    isAudioMuted: payload.isAudioMuted ?? false,
    isVideoMuted: payload.isVideoMuted ?? true,
    videoOverlayMode: payload.videoOverlayMode ?? 'hidden',
  };
  nativeCall.setBootstrapChannelId(snapshot.channelId);
  nativeCall.setSnapshot(snapshot);
}

const callEndedHandlers: CallEndedHandler[] = [];

/**
 * Registers channel-scoped cleanup for native CallKit end events.
 *
 * `useCallKitSetup` owns the single global Tauri listener, while `useCall()`
 * registers the active channel's leave handler here. If multiple channel UI
 * surfaces are mounted, the most recently registered active handler wins; when
 * it unmounts, the previous active handler becomes available again.
 */
export function registerCallKitCallEndedHandler(
  handler: CallEndedHandler
): () => void {
  if (!ENABLE_CALLKIT) return () => {};
  callEndedHandlers.push(handler);
  return () => {
    const index = callEndedHandlers.lastIndexOf(handler);
    if (index !== -1) callEndedHandlers.splice(index, 1);
  };
}

function getActiveCallEndedHandler(): CallEndedHandler | undefined {
  return callEndedHandlers[callEndedHandlers.length - 1];
}

export function isNativeIosCallKitEnabled(): boolean {
  return isNativeCallEnabled() && isPlatform('ios');
}

// Fresh CallKit launches can receive answer events before the router tree mounts.
const SPLIT_MANAGER_READY_TIMEOUT_MS = 15_000;
const DUPLICATE_ANSWERED_CALL_WINDOW_MS = 2_000;

async function joinChannelCallWhenReady(
  channelId: string,
  nativeMedia = false
): Promise<void> {
  console.info('[callkit] waiting for split manager before joining', {
    channelId,
    nativeMedia,
  });
  const splitManagerAbortController = new AbortController();
  try {
    await raceTimeout(
      whenSplitManagerReady(splitManagerAbortController.signal),
      SPLIT_MANAGER_READY_TIMEOUT_MS,
      true
    );
  } catch {
    splitManagerAbortController.abort();
    console.error(
      `[callkit] split manager not ready within ${SPLIT_MANAGER_READY_TIMEOUT_MS}ms; ending CallKit call`
    );
    await endCallKitCall();
    return;
  }
  console.info('[callkit] split manager ready; joining channel call', {
    channelId,
    nativeMedia,
  });
  if (nativeMedia) {
    console.info('[callkit] opening channel call tab for native media', {
      channelId,
    });
    return openChannelCallTab(channelId);
  }
  return joinChannelCall(channelId);
}

/**
 * Sets up CallKit / PushKit integration for iOS and Android.
 *
 * - Registers VoIP tokens with the backend as they arrive from PushKit.
 * - When the user answers via the native incoming-call sheet, navigates to the
 *   channel and joins the call via the existing deep-link flow.
 *
 * Must be mounted once at app startup on mobile (no-op on desktop).
 */
export function useCallKitSetup() {
  if (!isNativeCallEnabled()) return;

  const nativeCall = useNativeCallState();

  onMount(() => {
    console.info('[callkit] setting up iOS CallKit integration');

    let cleaned = false;
    let lastHandledAnsweredCall:
      | { key: string; handledAtMs: number }
      | undefined;
    const unregisters: Array<() => Promise<void>> = [];
    const channelWatchers: Array<Channel<unknown>> = [];
    onCleanup(() => {
      cleaned = true;
      unregisters.forEach((u) =>
        startLogged(u(), '[callkit] failed to unregister listener')
      );
      unregisters.length = 0;
      channelWatchers.length = 0;
    });

    function trackListener(
      promise: Promise<{ unregister: () => Promise<void> }>,
      label: string
    ) {
      const track = async () => {
        const l = await promise;
        if (cleaned) {
          startLogged(
            l.unregister(),
            `[callkit] failed to unregister ${label}`
          );
          return;
        }
        unregisters.push(() => l.unregister());
      };
      startLogged(track(), `[callkit] failed to register ${label}`);
    }

    function registerChannelWatcher<T>(
      command: string,
      label: string,
      handler: (payload: T) => void
    ) {
      const channel = new Channel<T>((payload) => {
        if (cleaned) return;
        handler(payload);
      });
      channelWatchers.push(channel as Channel<unknown>);
      const register = async () => {
        await invoke(`plugin:call-kit|${command}`, { channel });
        console.info(`[callkit] ${label} watcher registered`);
      };
      startLogged(register(), `[callkit] failed to register ${label} watcher`);
    }

    if (isPlatform('ios')) {
      // Token rotation: PushKit can hand us a new token at any point at runtime.
      trackListener(
        addPluginListener<VoipTokenPayload>(
          'call-kit',
          'voip-token-updated',
          async ({ token }) => {
            console.info('[callkit] received VoIP token update', {
              tokenLength: token.length,
            });
            await logFailure(
              registerVoipToken(token),
              '[callkit] failed to register VoIP token'
            );
          }
        ),
        'voip-token-updated'
      );

      // Cold start: drain any token that arrived from PushKit before the
      // listener above was registered.
      startLogged(
        syncVoipRegistration(),
        '[callkit] failed to register cached VoIP token'
      );

      // Account switch: rebind on login and remove on logout so the previous account's calls stop ringing this device. Registrations are idempotent upserts, so overlap between these three triggers is harmless.
      const removeVoipLifecycle = registerPushRegistrationLifecycle({
        syncRegistration: syncVoipRegistration,
        unregisterForLogout: unregisterVoipForLogout,
      });
      onCleanup(removeVoipLifecycle);
    }

    const handleCallAnswered = (
      { channelId, nativeMedia, callId, answeredAtMs }: CallAnsweredPayload,
      source: 'channel' | 'pending' = 'channel'
    ) => {
      const ageMs =
        answeredAtMs === undefined ? undefined : Date.now() - answeredAtMs;
      if (ageMs !== undefined && ageMs > ANSWERED_CALL_MAX_AGE_MS) {
        console.info('[callkit] ignoring stale answered call', {
          channelId,
          callId,
          ageMs,
          source,
        });
        return;
      }
      const answeredCallKey = answeredCallIdentity({
        channelId,
        nativeMedia,
        callId,
      });
      const now = Date.now();
      if (
        lastHandledAnsweredCall?.key === answeredCallKey &&
        now - lastHandledAnsweredCall.handledAtMs <
          DUPLICATE_ANSWERED_CALL_WINDOW_MS
      ) {
        return;
      }
      lastHandledAnsweredCall = { key: answeredCallKey, handledAtMs: now };

      console.info('[callkit] call answered event', {
        channelId,
        nativeMedia,
        source,
      });
      markNativeCallActivity();
      nativeCall.setBootstrapChannelId(channelId);
      startLogged(
        joinChannelCallWhenReady(channelId, nativeMedia),
        '[callkit] joinChannelCallWhenReady failed'
      );
    };

    registerChannelWatcher<CallAnsweredPayload>(
      'watch_call_answered',
      'call answered',
      (payload) => {
        handleCallAnswered(payload, 'channel');
        // Native retains the same answer for suspended/cold-start recovery.
        // Consume it now so a later foreground drain cannot navigate again.
        drainPendingAnsweredCall(payload);
      }
    );

    function drainPendingAnsweredCall(handled?: CallAnsweredPayload) {
      startLogged(
        handlePendingAnsweredCall(handled),
        '[callkit] get_pending_answered_call failed'
      );
    }

    async function handlePendingAnsweredCall(handled?: CallAnsweredPayload) {
      const { channelId, nativeMedia, callId, answeredAtMs } =
        await invoke<GetPendingAnsweredCallResponse>(
          'plugin:call-kit|get_pending_answered_call'
        );
      console.info('[callkit] drained pending answered call', {
        channelId,
        nativeMedia,
        callId,
      });
      if (!channelId) return;
      if (
        handled &&
        answeredCallIdentity(handled) ===
          answeredCallIdentity({
            channelId,
            nativeMedia: nativeMedia ?? false,
            callId: callId ?? undefined,
          })
      ) {
        return;
      }
      handleCallAnswered(
        {
          channelId,
          nativeMedia: nativeMedia ?? false,
          callId: callId ?? undefined,
          answeredAtMs: answeredAtMs ?? undefined,
        },
        'pending'
      );
    }

    drainPendingAnsweredCall();

    registerChannelWatcher<CallEndedPayload>(
      'watch_call_ended',
      'call ended',
      (payload) => {
        console.info('[callkit] call ended event', payload);
        // Native also emits call-ended for calls that never became the active
        // one, e.g. declining a second incoming call while already on a call.
        // Running the leave handler for those would hang up the current call.
        // Only filter when we positively know the active call: with no
        // snapshot (fresh webview) the event must still drive the leave.
        const activeCallId = nativeCall.snapshot()?.callId;
        if (
          activeCallId !== undefined &&
          activeCallId.toLowerCase() !== payload.callId.toLowerCase()
        ) {
          console.info('[callkit] ignoring ended call; not the active call', {
            activeCallId,
            endedCallId: payload.callId,
          });
          refreshActiveCallQueriesAfterLeave();
          return;
        }
        lastHandledAnsweredCall = undefined;
        refreshActiveCallQueriesAfterLeave();
        nativeCall.setBootstrapChannelId(null);
        nativeCall.setParticipantIdentities([]);
        const handler = getActiveCallEndedHandler();
        if (!handler) {
          console.warn(
            '[callkit] no call-ended handler registered; invalidating active call queries'
          );
          return;
        }
        startLogged(
          Promise.resolve(handler(payload)),
          '[callkit] failed to handle ended call'
        );
      }
    );

    registerChannelWatcher<ConnectionStatePayload>(
      'watch_connection_state',
      'connection state',
      (payload) => applyConnectionState(nativeCall, payload)
    );

    registerChannelWatcher<ParticipantIdentitiesPayload>(
      'watch_participant_identities',
      'participant identities',
      ({ identities }) => {
        console.info('[callkit] participant identities event', {
          identities,
        });
        nativeCall.setParticipantIdentities(identities);
      }
    );

    registerChannelWatcher<DrawerOpenedPayload>(
      'watch_drawer_opened',
      'drawer opened',
      ({ channelId }) => {
        console.info('[callkit] drawer opened event', {
          channelId,
        });
        markNativeCallActivity();
        nativeCall.setBootstrapChannelId(channelId);
        startLogged(
          joinChannelCallWhenReady(channelId, true),
          '[callkit] joinChannelCallWhenReady (drawer opened) failed'
        );
      }
    );

    startLogged(
      syncNativeCallState(nativeCall),
      '[callkit] initial native call state sync failed'
    );

    // The webview misses connection-state/call-ended channel events while iOS
    // has it suspended, leaving whatever call state existed at suspension
    // frozen in the UI. Re-sync with the plugin every time the app returns to
    // the foreground so an ended call can never keep rendering as active.
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      drainPendingAnsweredCall();
      startLogged(
        syncNativeCallState(nativeCall),
        '[callkit] foreground native call state sync failed'
      );
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    onCleanup(() =>
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    );
  });
}

export type NativeCallStateBeforeLeave = {
  snapshot: NativeCallSnapshot | null;
  bootstrapChannelId: string | null;
};

/**
 * Reconciles JS-side native call state with the plugin's actual state.
 *
 * Clears stale in-call state when native has no call (missed call-ended /
 * disconnect events) and restores the snapshot when native has a call the
 * webview does not know about (fresh webview during an active call). A live
 * snapshot for the same call is never overwritten by this point-in-time
 * query — the connection state watcher stays authoritative while events are
 * flowing — but a snapshot tracking a different call than native reports is
 * stale (both an end and an answer were missed) and is replaced.
 *
 * By default the destructive clear requires a quiet period (see
 * hasRecentNativeCallActivity). An explicit leave passes
 * `clearOnlyIfUnchangedSince` instead: the state observed when the leave began
 * is exactly what the user asked to leave, so it may be cleared regardless of
 * age — while state replaced mid-leave (a newer call) is preserved.
 */
async function syncNativeCallState(
  nativeCall: NativeCallState,
  options?: { clearOnlyIfUnchangedSince: NativeCallStateBeforeLeave }
): Promise<void> {
  const { state } = await invoke<GetActiveCallStateResponse>(
    'plugin:call-kit|get_active_call_state'
  );
  console.info('[callkit] native call state sync', { state });
  if (!state) {
    if (
      nativeCall.snapshot() === null &&
      nativeCall.bootstrapChannelId() === null
    ) {
      return;
    }
    const beforeLeave = options?.clearOnlyIfUnchangedSince;
    if (beforeLeave) {
      if (
        nativeCall.snapshot() !== beforeLeave.snapshot ||
        nativeCall.bootstrapChannelId() !== beforeLeave.bootstrapChannelId
      ) {
        console.info(
          '[callkit] skipping stale-state clear; call state changed during leave'
        );
        return;
      }
    } else if (hasRecentNativeCallActivity()) {
      // A call is likely still being established (native briefly reports no
      // call before its LiveKit session exists); events will settle the state.
      console.info(
        '[callkit] skipping stale-state clear; call state changed recently'
      );
      return;
    }
    console.info(
      '[callkit] clearing stale in-call state; native has no active call'
    );
    nativeCall.setBootstrapChannelId(null);
    nativeCall.setParticipantIdentities([]);
    nativeCall.setSnapshot(null);
    refreshActiveCallQueriesAfterLeave();
    return;
  }
  markNativeCallActivity();
  nativeCall.setParticipantIdentities(state.participantIdentities ?? []);
  const currentSnapshot = nativeCall.snapshot();
  if (
    currentSnapshot !== null &&
    currentSnapshot.callId.toLowerCase() === state.callId.toLowerCase()
  ) {
    return;
  }
  nativeCall.setBootstrapChannelId(state.channelId);
  nativeCall.setSnapshot({
    channelId: state.channelId,
    callId: state.callId,
    connectionState: state.connectionState,
    isAudioMuted: state.isAudioMuted,
    isVideoMuted: state.isVideoMuted,
    videoOverlayMode: state.videoOverlayMode,
  });
}

/**
 * Post-leave safety net: reconcile JS state with the plugin so a leave always
 * lands in a consistent state, even when the native call was already gone and
 * no disconnect event will ever arrive (e.g. state orphaned while the app was
 * suspended). `stateBeforeLeave` is the call state observed when the leave
 * began — clearing is scoped to exactly that state, bypassing the quiet-period
 * gate without risking a concurrently-established call's state.
 */
export async function syncNativeCallStateAfterLeave(
  nativeCall: NativeCallState,
  stateBeforeLeave: NativeCallStateBeforeLeave
): Promise<void> {
  if (!isNativeCallEnabled()) return;
  await syncNativeCallState(nativeCall, {
    clearOnlyIfUnchangedSince: stateBeforeLeave,
  });
}

function useCallKitNativeMetadataSync() {
  const nativeCall = useNativeCallState();
  const channelsCtx = useChannelsContext();

  const channelMetadata = createMemo((): NativeCallChannelMetadata | null => {
    const channelId = nativeCall.activeChannelId();
    if (!channelId) return null;

    const listedChannel = channelsCtx.channelsById()[channelId];
    if (listedChannel) {
      return {
        channelId,
        name: listedChannel.name,
      };
    }

    return null;
  });

  const channelTitleSyncValue = createMemo(
    (): NativeCallChannelTitleSyncValue => {
      const metadata = channelMetadata();
      if (!metadata) {
        return nativeCall.activeChannelId() ? undefined : null;
      }

      const channelTitle = metadata.name?.trim();
      if (!channelTitle) return undefined;

      return {
        channelId: metadata.channelId,
        channelTitle,
      };
    }
  );

  createEffect(
    on(channelTitleSyncValue, (syncValue, previousSyncValue) => {
      if (syncValue === undefined) return;

      if (syncValue === null) {
        if (previousSyncValue === null) return;
        startLogged(
          setNativeCallKitChannelTitle(null),
          '[callkit] failed to clear native channel title'
        );
        return;
      }

      if (
        previousSyncValue &&
        previousSyncValue.channelTitle === syncValue.channelTitle
      ) {
        return;
      }

      console.info('[callkit] syncing native channel title', syncValue);
      startLogged(
        setNativeCallKitChannelTitle(syncValue.channelTitle),
        '[callkit] failed to sync native channel title'
      );
    })
  );

  return null;
}

function useCallKitParticipantDisplayNameSync() {
  const nativeCall = useNativeCallState();
  const nativeParticipantIds = createMemo(() =>
    nativeCall.participantIdentities()
  );
  const participantIds = createMemo(() =>
    uniqueParticipantIds(nativeParticipantIds())
  );

  const participantUserNameQueries = useUserNamesQuery({
    userIds: participantIds,
    enabled: () => participantIds().length > 0,
  });

  const participantDisplayNames = createMemo(
    (): NativeParticipantDisplayNames | undefined => {
      const ids = participantIds();
      if (ids.length === 0) return undefined;

      const isPending = participantUserNameQueries.some(
        (query) => query.isPending
      );
      if (isPending) return { isPending: true };

      const fetchedNames = participantUserNameQueries
        .map((query) => query.data)
        .filter((name): name is UserName => Boolean(name));

      return {
        isPending: false,
        displayNames: buildParticipantDisplayNames(
          ids,
          fallbackParticipantDisplayNames(ids),
          fetchedNames
        ),
        fetchedNameCount: fetchedNames.length,
        errors: participantUserNameQueries
          .filter((query) => query.isError)
          .map((query) => query.error),
      };
    }
  );

  createEffect(
    on(participantDisplayNames, (displayNameData) => {
      if (!displayNameData) return;
      if (displayNameData.isPending) return;

      const channelId = nativeCall.activeChannelId();
      const nativeParticipantIds = nativeCall.participantIdentities();
      const ids = participantIds();

      if (displayNameData.errors.length > 0) {
        console.error('[callkit] failed to fetch participant display names', {
          channelId,
          nativeParticipantIds,
          participantIds: ids,
          errors: displayNameData.errors,
        });
      }

      console.info('[callkit] syncing native participant display names', {
        channelId,
        participantCount: ids.length,
        fetchedNameCount: displayNameData.fetchedNameCount,
      });

      syncNativeParticipantDisplayNames(displayNameData.displayNames);
    })
  );

  return null;
}

export function CallKitSync() {
  if (!isNativeCallEnabled()) return null;

  useCallKitNativeMetadataSync();
  useCallKitParticipantDisplayNameSync();
  useCallKitThemeSync();
  return null;
}

function buildParticipantDisplayNames(
  participantIds: string[],
  fallbackNames: Record<string, string>,
  fetchedNames: UserName[]
): Record<string, string> {
  const displayNames = { ...fallbackNames };
  const fetchedNamesByIdentity = new Map<string, string>();

  for (const user of fetchedNames) {
    fetchedNamesByIdentity.set(
      normalizeParticipantIdentity(user.id),
      displayNameFromUserName(user)
    );
  }

  for (const identity of participantIds) {
    displayNames[identity] =
      fetchedNamesByIdentity.get(normalizeParticipantIdentity(identity)) ??
      fallbackNames[identity];
  }

  return displayNames;
}

function fallbackParticipantDisplayNames(
  participantIds: string[]
): Record<string, string> {
  return Object.fromEntries(
    participantIds.map((identity) => [
      identity,
      fallbackParticipantName(identity),
    ])
  );
}

function syncNativeParticipantDisplayNames(
  displayNames: Record<string, string>
) {
  for (const [identity, displayName] of Object.entries(displayNames)) {
    startLogged(
      setNativeCallKitParticipantDisplayName(identity, displayName),
      '[callkit] failed to sync native participant display name'
    );
  }
}

function uniqueParticipantIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const participantIds: string[] = [];
  for (const id of ids) {
    const trimmedId = id.trim();
    const normalizedId = normalizeParticipantIdentity(trimmedId);
    if (!isMacroParticipantIdentity(trimmedId) || seen.has(normalizedId)) {
      continue;
    }
    seen.add(normalizedId);
    participantIds.push(trimmedId);
  }
  return participantIds;
}

function isMacroParticipantIdentity(identity: string): boolean {
  const trimmedIdentity = identity.trim();
  return (
    normalizeParticipantIdentity(trimmedIdentity).startsWith('macro|') &&
    trimmedIdentity.includes('@')
  );
}

function normalizeParticipantIdentity(identity: string): string {
  return identity.trim().toLowerCase();
}

function displayNameFromUserName(user: {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
}): string {
  const parts = [user.first_name, user.last_name]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part) && part !== 'N/A');
  return parts.length > 0 ? parts.join(' ') : fallbackParticipantName(user.id);
}

function fallbackParticipantName(identity: string): string {
  return identity.split('|').at(1)?.split('@').at(0) || 'Participant';
}

/**
 * Tells CallKit to end the active call session.
 *
 * Call this from `leaveCall()` so the native system call UI is dismissed when
 * the user leaves from within the app rather than from the CallKit sheet.
 */
export async function endCallKitCall(): Promise<void> {
  if (!isNativeCallEnabled()) return;
  await logFailure(
    invoke('plugin:call-kit|end_active_call'),
    '[callkit] failed to end active call'
  );
}

const pendingAndroidJoins = new Map<string, string>();

/** Pause ring resolution before the join API marks this user as answered. */
export async function prepareNativeCallJoin(
  channelId: string
): Promise<() => Promise<void>> {
  if (!isNativeCallEnabled() || !isPlatform('android')) return async () => {};
  const { lease } = await invoke<{ lease: string }>(
    'plugin:call-kit|prepare_join',
    { channelId }
  );
  pendingAndroidJoins.set(channelId, lease);
  let cleaned = false;
  return async () => {
    if (cleaned) return;
    cleaned = true;
    if (pendingAndroidJoins.get(channelId) === lease)
      pendingAndroidJoins.delete(channelId);
    await invoke('plugin:call-kit|abort_join', { lease });
  };
}

export async function startNativeCallKitOutgoingCall(
  args: StartOutgoingCallArgs,
  nativeCall: Pick<NativeCallState, 'setBootstrapChannelId'>
): Promise<void> {
  if (!isNativeCallEnabled()) return;
  console.info('[callkit] starting native outgoing call', {
    channelId: args.channelId,
    callId: args.callId,
    channelTitle: args.channelTitle,
  });
  await invoke('plugin:call-kit|start_outgoing_call', {
    ...args,
    ...(isPlatform('android')
      ? { joinLease: pendingAndroidJoins.get(args.channelId) ?? null }
      : {}),
  });
  markNativeCallActivity();
  nativeCall.setBootstrapChannelId(args.channelId);
}

export async function setNativeCallKitVideoOverlayMode(
  mode: NativeCallSnapshot['videoOverlayMode']
): Promise<void> {
  if (!isNativeCallEnabled()) return;
  await logFailure(
    invoke('plugin:call-kit|set_video_overlay_mode', { mode }),
    '[callkit] failed to set native video overlay mode'
  );
}

async function setNativeCallKitChannelTitle(
  channelTitle: string | null
): Promise<void> {
  if (!isNativeCallEnabled()) return;
  await logFailure(
    invoke('plugin:call-kit|set_call_drawer_channel_title', { channelTitle }),
    '[callkit] failed to set native channel title'
  );
}

async function setNativeCallKitParticipantDisplayName(
  identity: string,
  displayName: string | null
): Promise<void> {
  if (!isNativeCallEnabled()) return;
  await logFailure(
    invoke('plugin:call-kit|set_participant_display_name', {
      identity,
      displayName,
    }),
    '[callkit] failed to set native participant display name'
  );
}

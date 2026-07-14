import { whenSplitManagerReady } from '@app/signal/splitLayout';
import { ENABLE_CALLKIT } from '@core/constant/featureFlags';
import { useChannelsContext } from '@core/context/channels';
import { isPlatform, isTauri } from '@core/util/platform';
import { useUserNamesQuery } from '@queries/auth';
import { invalidateActiveCallQueries } from '@queries/call/call';
import type { UserName } from '@service-auth/generated/schemas/userName';
import { notificationServiceClient } from '@service-notification/client';
import type { DeviceType } from '@service-notification/generated/schemas/deviceType';
import { raceTimeout } from '@solid-primitives/promise';
import { addPluginListener, Channel, invoke } from '@tauri-apps/api/core';
import { createEffect, createMemo, on, onCleanup, onMount } from 'solid-js';
import { joinChannelCall } from './join-channel-call';
import {
  type NativeCallSnapshot,
  type NativeCallState,
  useNativeCallState,
} from './native-call-state';
import { openChannelCallTab } from './open-channel-call-tab';
import { useCallKitThemeSync } from './use-callkit-theme-sync';

// The 'iosvoip' variant exists in the backend but the generated schema has not been
// regenerated to include it yet. Cast until a regeneration picks it up.
const DEVICE_TYPE_IOS_VOIP = 'iosvoip' as DeviceType;

type VoipTokenPayload = { token: string };
type CallAnsweredPayload = { channelId: string; nativeMedia?: boolean };
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
};

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

function refreshActiveCallQueriesAfterLeave() {
  void invalidateActiveCallQueries().catch((err) =>
    console.error('[callkit] failed to refresh active call state', err)
  );
}

function applyConnectionState(
  nativeCall: NativeCallState,
  payload: ConnectionStatePayload
) {
  console.info('[callkit] connection state channel message', payload);
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
  return ENABLE_CALLKIT && isTauri() && isPlatform('ios');
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
 * Sets up CallKit / PushKit integration for iOS.
 *
 * - Registers VoIP tokens with the backend as they arrive from PushKit.
 * - When the user answers via the native incoming-call sheet, navigates to the
 *   channel and joins the call via the existing deep-link flow.
 *
 * Must be mounted once at app startup on iOS (no-op on all other platforms).
 */
export function useCallKitSetup() {
  if (!isNativeIosCallKitEnabled()) return;

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
        u().catch((err) =>
          console.error('[callkit] failed to unregister listener', err)
        )
      );
      unregisters.length = 0;
      channelWatchers.length = 0;
    });

    function trackListener(
      promise: Promise<{ unregister: () => Promise<void> }>,
      label: string
    ) {
      promise
        .then((l) => {
          if (cleaned) {
            l.unregister().catch((err) =>
              console.error(`[callkit] failed to unregister ${label}`, err)
            );
            return;
          }
          unregisters.push(() => l.unregister());
        })
        .catch((err) =>
          console.error(`[callkit] failed to register ${label}`, err)
        );
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
      invoke(`plugin:call-kit|${command}`, { channel })
        .then(() => console.info(`[callkit] ${label} watcher registered`))
        .catch((err) =>
          console.error(`[callkit] failed to register ${label} watcher`, err)
        );
    }

    trackListener(
      addPluginListener<VoipTokenPayload>(
        'call-kit',
        'voip-token-updated',
        async ({ token }) => {
          console.info('[callkit] received VoIP token update', {
            tokenLength: token.length,
          });
          await notificationServiceClient
            .registerDevice({ token, deviceType: DEVICE_TYPE_IOS_VOIP })
            .catch((err) =>
              console.error('[callkit] failed to register VoIP token', err)
            );
        }
      ),
      'voip-token-updated'
    );

    // Drain any VoIP token that arrived from PushKit before the listener above
    // was registered (common on first launch).
    invoke<{ token: string | null }>('plugin:call-kit|get_voip_token')
      .then(({ token }) => {
        if (!token) return;
        console.info('[callkit] registering cached VoIP token', {
          tokenLength: token.length,
        });
        return notificationServiceClient
          .registerDevice({ token, deviceType: DEVICE_TYPE_IOS_VOIP })
          .catch((err) =>
            console.error('[callkit] failed to register cached VoIP token', err)
          );
      })
      .catch((err) => console.error('[callkit] get_voip_token failed', err));

    const handleCallAnswered = (
      { channelId, nativeMedia }: CallAnsweredPayload,
      source: 'channel' | 'pending' = 'channel'
    ) => {
      const answeredCallKey = `${channelId}:${nativeMedia ?? false}`;
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
      nativeCall.setBootstrapChannelId(channelId);
      joinChannelCallWhenReady(channelId, nativeMedia).catch((err) =>
        console.error('[callkit] joinChannelCallWhenReady failed', err)
      );
    };

    registerChannelWatcher<CallAnsweredPayload>(
      'watch_call_answered',
      'call answered',
      (payload) => handleCallAnswered(payload, 'channel')
    );

    const drainPendingAnsweredCall = () => {
      invoke<GetPendingAnsweredCallResponse>(
        'plugin:call-kit|get_pending_answered_call'
      )
        .then(({ channelId, nativeMedia }) => {
          console.info('[callkit] drained pending answered call', {
            channelId,
            nativeMedia,
          });
          if (!channelId) return;
          handleCallAnswered(
            { channelId, nativeMedia: nativeMedia ?? false },
            'pending'
          );
        })
        .catch((err) =>
          console.error('[callkit] get_pending_answered_call failed', err)
        );
    };

    drainPendingAnsweredCall();

    registerChannelWatcher<CallEndedPayload>(
      'watch_call_ended',
      'call ended',
      (payload) => {
        console.info('[callkit] call ended event', payload);
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
        Promise.resolve(handler(payload)).catch((err) =>
          console.error('[callkit] failed to handle ended call', err)
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
        nativeCall.setBootstrapChannelId(channelId);
        joinChannelCallWhenReady(channelId, true).catch((err) =>
          console.error(
            '[callkit] joinChannelCallWhenReady (drawer opened) failed',
            err
          )
        );
      }
    );

    // Do not let a stale startup drain overwrite live listener state.
    invoke<GetActiveCallStateResponse>('plugin:call-kit|get_active_call_state')
      .then(({ state }) => {
        console.info('[callkit] initial active call state', { state });
        if (!state) return;
        nativeCall.setParticipantIdentities(state.participantIdentities ?? []);
        if (nativeCall.snapshot() !== null) return;
        nativeCall.setBootstrapChannelId(state.channelId);
        nativeCall.setSnapshot({
          channelId: state.channelId,
          callId: state.callId,
          connectionState: state.connectionState,
          isAudioMuted: state.isAudioMuted,
          isVideoMuted: state.isVideoMuted,
          videoOverlayMode: state.videoOverlayMode,
        });
      })
      .catch((err) =>
        console.error('[callkit] get_active_call_state failed', err)
      );
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
        setNativeCallKitChannelTitle(null).catch((err) =>
          console.error('[callkit] failed to clear native channel title', err)
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
      setNativeCallKitChannelTitle(syncValue.channelTitle).catch((err) =>
        console.error('[callkit] failed to sync native channel title', err)
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
  if (!isNativeIosCallKitEnabled()) return null;

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
    setNativeCallKitParticipantDisplayName(identity, displayName).catch((err) =>
      console.error(
        '[callkit] failed to sync native participant display name',
        err
      )
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
  if (!isNativeIosCallKitEnabled()) return;
  await invoke('plugin:call-kit|end_active_call').catch((err) =>
    console.error('[callkit] failed to end active call', err)
  );
}

export async function startNativeCallKitOutgoingCall(
  args: StartOutgoingCallArgs,
  nativeCall: Pick<NativeCallState, 'setBootstrapChannelId'>
): Promise<void> {
  if (!isNativeIosCallKitEnabled()) return;
  console.info('[callkit] starting native outgoing call', {
    channelId: args.channelId,
    callId: args.callId,
    channelTitle: args.channelTitle,
  });
  await invoke('plugin:call-kit|start_outgoing_call', args);
  nativeCall.setBootstrapChannelId(args.channelId);
}

export async function setNativeCallKitVideoOverlayMode(
  mode: NativeCallSnapshot['videoOverlayMode']
): Promise<void> {
  if (!isNativeIosCallKitEnabled()) return;
  await invoke('plugin:call-kit|set_video_overlay_mode', { mode }).catch(
    (err) =>
      console.error('[callkit] failed to set native video overlay mode', err)
  );
}

async function setNativeCallKitChannelTitle(
  channelTitle: string | null
): Promise<void> {
  if (!isNativeIosCallKitEnabled()) return;
  await invoke('plugin:call-kit|set_call_drawer_channel_title', {
    channelTitle,
  }).catch((err) =>
    console.error('[callkit] failed to set native channel title', err)
  );
}

async function setNativeCallKitParticipantDisplayName(
  identity: string,
  displayName: string | null
): Promise<void> {
  if (!isNativeIosCallKitEnabled()) return;
  await invoke('plugin:call-kit|set_participant_display_name', {
    identity,
    displayName,
  }).catch((err) =>
    console.error(
      '[callkit] failed to set native participant display name',
      err
    )
  );
}

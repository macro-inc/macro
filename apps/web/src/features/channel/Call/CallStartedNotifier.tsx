import { useChannelsContext } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { usePlatformNotificationState } from '@notifications';
import { DefaultUserNameResolver } from '@notifications/notification-resolvers';
import {
  invalidateActiveCallQueries,
  setActiveCallEndedCache,
  setActiveCallStartedCache,
} from '@queries/call/call';
import { useCallContext } from './CallContext';
import { createCallEventsEffect } from './call-events';
import {
  createCallResolutionsEffect,
  publishCallResolution,
} from './call-resolution';
import { joinChannelCall } from './join-channel-call';
import {
  attachRingCoordination,
  participateInRing,
  type RingParticipation,
  silenceIncomingCallRing,
} from './ring-coordination';

const RING_VOLUME = 0.11;
const RING_NOTE_DURATION_S = 0.09;
const RING_NOTE_GAP_S = 0.075;
const RING_PHRASE_GAP_S = 0.26;
const RING_FADE_S = 0.018;
// Deeper ripple call chime: G4, B4, G4, E4, G4, B4, D5. Played twice per ring.
const RING_CHIME_FREQUENCIES_HZ = [
  392.0, 493.88, 392.0, 329.63, 392.0, 493.88, 587.33,
];
// Phone-style cadence: re-ring every few seconds while the call is incoming.
const RING_INTERVAL_MS = 4_000;
/**
 * Stop ringing after this long if the user neither answers nor dismisses, so
 * a missed call doesn't keep noise-making forever. Shared with the incoming
 * call store so its auto-dismiss stays in lockstep with the ringer.
 */
export const MAX_RING_DURATION_MS = 30_000;

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };
type RingSound = { durationMs: number; stop: () => void };
type Ringer = { stop: () => void };

const activeCallRingers = new Map<string, Ringer>();

// Incoming-call notification handles by call id, so the toast can be closed
// when the ring resolves remotely (answered on another device). Best-effort:
// the Tauri notification handle's close() is currently a no-op.
const activeCallNotifications = new Map<string, { close: () => void }>();

// Notifications still being created (showNotification is async), so a remote
// answer that lands mid-flight can cancel the toast once it materializes
// instead of leaving a stale requireInteraction toast up indefinitely.
const pendingCallNotifications = new Map<string, { cancelled: boolean }>();

export function stopCallRinger(callId: string) {
  activeCallRingers.get(callId)?.stop();
  activeCallRingers.delete(callId);
}

function closeCallNotification(callId: string) {
  const pending = pendingCallNotifications.get(callId);
  if (pending) pending.cancelled = true;
  activeCallNotifications.get(callId)?.close();
  activeCallNotifications.delete(callId);
}

/**
 * Starts this tab's participation in ringing `callId`. Only the tab that
 * wins the cross-tab election actually makes noise; the others stay silent
 * but take the ring over if the audible tab goes away mid-ring (see
 * `ring-coordination.ts`).
 */
function startCallRinger(callId: string, shouldStop: () => boolean): Ringer {
  stopCallRinger(callId);

  let loop: Ringer | undefined;
  let isReleasingLoop = false;
  let participation: RingParticipation | undefined;
  const ringer: Ringer = { stop: () => participation?.stop() };
  activeCallRingers.set(callId, ringer);

  participation = participateInRing({
    callId,
    shouldStop,
    maxDurationMs: MAX_RING_DURATION_MS,
    onAcquire: () => {
      loop = startRingingLoop(shouldStop, playRingSound(), () => {
        // The loop stopping on its own (user joined, max duration) also ends
        // the participation, so this tab stops heartbeating a claim it no
        // longer rings for. Guarded so a release-triggered stop does not end
        // the participation — a demoted tab must stay in the election as a
        // takeover candidate.
        if (!isReleasingLoop) participation?.stop();
      });
    },
    onRelease: () => {
      isReleasingLoop = true;
      loop?.stop();
      isReleasingLoop = false;
      loop = undefined;
    },
    onEnd: () => {
      if (activeCallRingers.get(callId) === ringer) {
        activeCallRingers.delete(callId);
      }
    },
  });

  return ringer;
}

function playRingSound(): RingSound | undefined {
  const Ctx =
    window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
  if (!Ctx) return undefined;

  let ctx: AudioContext;
  try {
    ctx = new Ctx();
  } catch (e) {
    console.warn('Failed to create AudioContext for call ring', e);
    return undefined;
  }

  const playNote = (start: number, freq: number, volume: number) => {
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + RING_FADE_S);
    gain.gain.exponentialRampToValueAtTime(0.001, start + RING_NOTE_DURATION_S);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(gain);
    osc.start(start);
    osc.stop(start + RING_NOTE_DURATION_S + RING_FADE_S);
  };

  const playPhrase = (start: number, volume: number) => {
    RING_CHIME_FREQUENCIES_HZ.forEach((freq, i) => {
      playNote(
        start + i * (RING_NOTE_DURATION_S + RING_NOTE_GAP_S),
        freq,
        volume
      );
    });
  };

  const phraseDuration =
    RING_CHIME_FREQUENCIES_HZ.length * RING_NOTE_DURATION_S +
    (RING_CHIME_FREQUENCIES_HZ.length - 1) * RING_NOTE_GAP_S;
  const t0 = ctx.currentTime;
  playPhrase(t0, RING_VOLUME);
  playPhrase(t0 + phraseDuration + RING_PHRASE_GAP_S, RING_VOLUME * 0.75);

  const totalMs =
    (phraseDuration * 2 + RING_PHRASE_GAP_S + RING_FADE_S) * 1000 + 200;

  let stopped = false;
  const timeoutId = window.setTimeout(() => {
    stopped = true;
    void ctx.close().catch(() => {});
  }, totalMs);

  return {
    durationMs: totalMs,
    stop: () => {
      if (stopped) return;
      stopped = true;
      window.clearTimeout(timeoutId);
      void ctx.close().catch(() => {});
    },
  };
}

function startRingingLoop(
  shouldStop: () => boolean,
  initialSound?: RingSound,
  onStop?: () => void
): Ringer {
  let stopped = false;
  const activeSounds = new Set<RingSound>();

  const trackSound = (sound: RingSound | undefined) => {
    if (!sound) return;
    activeSounds.add(sound);
    window.setTimeout(() => {
      activeSounds.delete(sound);
    }, sound.durationMs);
  };

  trackSound(initialSound);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(intervalId);
    window.clearTimeout(timeoutId);
    for (const sound of activeSounds) {
      sound.stop();
    }
    activeSounds.clear();
    onStop?.();
  };

  const intervalId = window.setInterval(() => {
    if (shouldStop()) {
      stop();
      return;
    }
    trackSound(playRingSound());
  }, RING_INTERVAL_MS);

  const timeoutId = window.setTimeout(stop, MAX_RING_DURATION_MS);

  return { stop };
}

/**
 * Listens for `call_started` websocket events broadcast to channel members
 * and surfaces a browser notification + ring tone for the recipients.
 *
 * Also resolves the ring remotely: `call_answered` (sent to just this user
 * when they join the call on any device, e.g. answering on iPhone) and
 * `call_ended` both stop the ring; `call_answered` additionally closes the
 * incoming-call notification since the user is already in the call.
 *
 * This component is the sole bridge from those one-shot websocket events to
 * published call resolutions (`call-resolution.ts`) — resolution consumers
 * like `IncomingCallEvents` rely on it being mounted for instant dismissal,
 * falling back to their reconciliation poll otherwise.
 *
 * The ring itself is elected across tabs (`ring-coordination.ts`) so an
 * incoming call sounds like one phone instead of one per open tab; the toast
 * is already deduplicated separately by the platform-notification leader
 * election.
 *
 * Mount once near the app root, inside `<CallProvider>` and
 * `<ChannelsContextProvider>`. The backend already excludes the caller from
 * the broadcast (`call_service::send_call_event` filters on
 * `triggered_by_user_id`), but we additionally skip when the user is already
 * in the call as a defensive guard against same-user multi-device delivery.
 */
export function CallStartedNotifier() {
  const callCtx = useCallContext();
  const channelsCtx = useChannelsContext();
  const notif = usePlatformNotificationState();
  const userId = useUserId();

  // Attach up front so sibling tabs' ring claims are already recorded when
  // this tab's own `call_started` event arrives (event delivery across tabs
  // can be milliseconds to seconds apart).
  attachRingCoordination();

  createCallResolutionsEffect((resolution) => {
    if (resolution.type === 'answered') {
      if (resolution.answeredBy !== userId()) return;
      stopCallRinger(resolution.callId);
      closeCallNotification(resolution.callId);
      // The creator's other devices never receive call_started; a refetch
      // picks the now-answered call up for their active-call badges.
      void invalidateActiveCallQueries();
      return;
    }

    stopCallRinger(resolution.callId);
    setActiveCallEndedCache({
      channelId: resolution.channelId,
      callId: resolution.callId,
    });
    void invalidateActiveCallQueries();
  });

  createCallEventsEffect({
    onCallEnded: ({ channelId, callId }) => {
      publishCallResolution({ type: 'ended', channelId, callId });
    },

    onCallAnswered: ({ callId, answeredBy }) => {
      const answeringUserId = answeredBy ?? userId();
      if (!answeringUserId) return;
      publishCallResolution({
        type: 'answered',
        callId,
        answeredBy: answeringUserId,
      });
    },

    onCallStarted: ({ channelId, callId, createdBy, isFromSelf }) => {
      const createdAt = new Date().toISOString();
      setActiveCallStartedCache({
        channelId,
        callId,
        createdAt,
        createdBy: createdBy ?? '',
      });
      void invalidateActiveCallQueries();

      // The cache above is updated for every call, including our own; only the
      // ring and the toast are skipped when we're already in it or started it.
      if (callCtx.activeCallId() === callId) return;
      if (isFromSelf) return;

      void emitCallStartedNotification({
        channelId,
        callId,
        createdBy,
        channelName: channelsCtx.channelsById()[channelId]?.name ?? undefined,
        notif,
        isJoined: () => callCtx.activeCallId() === callId,
      });
    },
  });

  return null;
}

async function emitCallStartedNotification(args: {
  channelId: string;
  callId: string;
  createdBy: string | null;
  channelName: string | undefined;
  notif: ReturnType<typeof usePlatformNotificationState>;
  isJoined: () => boolean;
}) {
  const { channelId, callId, createdBy, channelName, notif, isJoined } = args;

  // Ring regardless of notification permission so a user with browser
  // notifications denied still gets an audio cue. Only the tab that wins the
  // cross-tab election makes noise; this tab still participates so it can
  // take the ring over if the audible tab closes mid-ring. The ring stops
  // when the user joins, the call ends, the ring is silenced in any tab, or
  // after MAX_RING_DURATION_MS.
  const ringer = startCallRinger(callId, isJoined);

  if (notif === 'not-supported') return;

  const pending = { cancelled: false };
  pendingCallNotifications.set(callId, pending);
  try {
    const callerName =
      (createdBy ? await DefaultUserNameResolver(createdBy) : undefined) ??
      'Someone';
    const target = channelName ? ` in ${channelName}` : '';

    const handle = await notif.showNotification({
      title: `Incoming call${target}`,
      options: {
        body: `${callerName} started a call`,
        // Keep the toast visible until the user answers or dismisses it,
        // instead of the browser's default few-second auto-dismiss.
        requireInteraction: true,
        // Collapse duplicate broadcasts (e.g. multi-device) into one toast.
        tag: `call-${callId}`,
      },
    });

    if (handle === 'not-granted' || handle === 'disabled-in-ui') return;

    // The call was answered remotely while the toast was being created.
    if (pending.cancelled) {
      handle.close();
      return;
    }

    activeCallNotifications.set(callId, handle);

    const untrack = () => {
      if (activeCallNotifications.get(callId) === handle) {
        activeCallNotifications.delete(callId);
      }
    };
    handle.onClick(() => {
      window.focus();
      void joinChannelCall(channelId);
      handle.close();
      untrack();
      ringer.stop();
    });
    handle.onDismiss(() => {
      untrack();
      // Closing the toast is an explicit "stop ringing": the audible tab may
      // be a sibling, so silence the ring everywhere rather than just here.
      // Also fires after our own `handle.close()` calls, where the ring is
      // ending anyway and the extra silence is harmless.
      silenceIncomingCallRing(callId);
    });
  } finally {
    if (pendingCallNotifications.get(callId) === pending) {
      pendingCallNotifications.delete(callId);
    }
  }
}

import { ENABLE_CALLS } from '@core/constant/featureFlags';
import { useChannelsContext } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { usePlatformNotificationState } from '@notifications';
import { DefaultUserNameResolver } from '@notifications/notification-resolvers';
import { createConnectionWebsocketEffect } from '@service-connection/websocket';
import { useCallContext } from './CallContext';
import { joinChannelCall } from './join-channel-call';

type CallStartedPayload = {
  channel_id?: string;
  call_id?: string;
  created_by?: string | null;
};

const RING_VOLUME = 0.15;
const RING_PULSE_DURATION_S = 0.4;
const RING_PULSE_GAP_S = 0.2;
const RING_FADE_S = 0.02;
// US dial-tone-style ring: superimposed 440Hz + 480Hz.
const RING_FREQUENCIES_HZ = [440, 480];

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

function playRingSound() {
  const Ctx =
    window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
  if (!Ctx) return;

  let ctx: AudioContext;
  try {
    ctx = new Ctx();
  } catch (e) {
    console.warn('Failed to create AudioContext for call ring', e);
    return;
  }

  const playPulse = (start: number) => {
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(RING_VOLUME, start + RING_FADE_S);
    gain.gain.linearRampToValueAtTime(0, start + RING_PULSE_DURATION_S);

    for (const freq of RING_FREQUENCIES_HZ) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(start);
      osc.stop(start + RING_PULSE_DURATION_S + RING_FADE_S);
    }
  };

  const t0 = ctx.currentTime;
  playPulse(t0);
  playPulse(t0 + RING_PULSE_DURATION_S + RING_PULSE_GAP_S);

  const totalMs =
    (RING_PULSE_DURATION_S * 2 + RING_PULSE_GAP_S + RING_FADE_S) * 1000 + 200;
  setTimeout(() => {
    void ctx.close().catch(() => {});
  }, totalMs);
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function parsePayload(raw: unknown): CallStartedPayload | null {
  const obj =
    typeof raw === 'string'
      ? safeJsonParse(raw)
      : typeof raw === 'object'
        ? raw
        : null;
  if (!obj || typeof obj !== 'object') return null;
  return obj as CallStartedPayload;
}

/**
 * Listens for `call_started` websocket events broadcast to channel members
 * and surfaces a browser notification + ring tone for the recipients.
 *
 * Mount once near the app root, inside `<CallProvider>` and
 * `<ChannelsContextProvider>`. The backend already excludes the caller from
 * the broadcast (`call_service::send_call_event` filters on
 * `triggered_by_user_id`), but we additionally skip when the user is already
 * in the call as a defensive guard against same-user multi-device delivery.
 */
export function CallStartedNotifier() {
  const callCtx = useCallContext();
  const userId = useUserId();
  const channelsCtx = useChannelsContext();
  const notif = usePlatformNotificationState();

  createConnectionWebsocketEffect((data) => {
    if (data.type !== 'call_started') return;
    if (!ENABLE_CALLS()) return;

    const payload = parsePayload(data.data);
    if (!payload) return;

    const {
      channel_id: channelId,
      call_id: callId,
      created_by: createdBy,
    } = payload;
    if (!channelId || !callId) return;

    if (callCtx.activeCallId() === callId) return;
    if (createdBy && createdBy === userId()) return;

    void emitCallStartedNotification({
      channelId,
      createdBy: createdBy ?? null,
      channelName: channelsCtx.channelsById()[channelId]?.name ?? undefined,
      notif,
    });
  });

  return null;
}

async function emitCallStartedNotification(args: {
  channelId: string;
  createdBy: string | null;
  channelName: string | undefined;
  notif: ReturnType<typeof usePlatformNotificationState>;
}) {
  const { channelId, createdBy, channelName, notif } = args;

  // Play the sound regardless of notification permission so a user with
  // browser notifications denied still gets an audio cue.
  playRingSound();

  if (notif === 'not-supported') return;

  const callerName =
    (createdBy ? await DefaultUserNameResolver(createdBy) : undefined) ??
    'Someone';
  const target = channelName ? ` in #${channelName}` : '';

  const handle = await notif.showNotification({
    title: `Incoming call${target}`,
    options: {
      body: `${callerName} started a call`,
    },
  });

  if (handle === 'not-granted' || handle === 'disabled-in-ui') return;
  handle.onClick(() => {
    window.focus();
    void joinChannelCall(channelId);
    handle.close();
  });
}

/**
 * Lazy loaders for the browser call SDKs.
 *
 * CallProvider mounts with the app shell, but LiveKit and Krisp are only needed
 * once a browser call starts. Keeping all value imports in this module prevents
 * both SDKs (including Krisp's inlined model) from entering the initial bundle.
 */
import type {
  ConnectionState,
  DisconnectReason,
  RoomEvent,
  Track,
} from 'livekit-client';

type LivekitModule = typeof import('livekit-client');
type KrispModule = typeof import('@livekit/krisp-noise-filter');

let livekit: LivekitModule | null = null;
let livekitPromise: Promise<LivekitModule> | null = null;
let krisp: KrispModule | null = null;
let krispPromise: Promise<KrispModule> | null = null;

async function importLivekit(): Promise<LivekitModule> {
  try {
    livekit = await import('livekit-client');
    return livekit;
  } catch (error) {
    // A transient chunk/network failure must not poison every later retry.
    livekitPromise = null;
    throw error;
  }
}

export function loadLivekit(): Promise<LivekitModule> {
  livekitPromise ??= importLivekit();
  return livekitPromise;
}

export function getLivekit(): LivekitModule | null {
  return livekit;
}

async function importKrisp(): Promise<KrispModule> {
  try {
    krisp = await import('@livekit/krisp-noise-filter');
    return krisp;
  } catch (error) {
    krispPromise = null;
    throw error;
  }
}

export function loadKrisp(): Promise<KrispModule> {
  krispPromise ??= importKrisp();
  return krispPromise;
}

export function getKrisp(): KrispModule | null {
  return krisp;
}

/** Returns false until Krisp has loaded or when the browser is unsupported. */
export function isKrispSupported(): boolean {
  return krisp?.isKrispNoiseFilterSupported() ?? false;
}

// Compile-time-checked mirrors let shell code compare SDK enum values without
// evaluating livekit-client. A changed upstream value will fail type-checking.
export const LK_CONNECTION_STATE = {
  Disconnected: 'disconnected' as ConnectionState.Disconnected,
  Connecting: 'connecting' as ConnectionState.Connecting,
  Connected: 'connected' as ConnectionState.Connected,
  Reconnecting: 'reconnecting' as ConnectionState.Reconnecting,
  SignalReconnecting:
    'signalReconnecting' as ConnectionState.SignalReconnecting,
} as const;

export const LK_TRACK_SOURCE = {
  Camera: 'camera' as Track.Source.Camera,
  Microphone: 'microphone' as Track.Source.Microphone,
  ScreenShare: 'screen_share' as Track.Source.ScreenShare,
} as const;

export const LK_ROOM_EVENT = {
  Disconnected: 'disconnected' as RoomEvent.Disconnected,
} as const;

// DisconnectReason is a protobuf enum; the numeric values are wire-stable.
export const LK_DISCONNECT_REASON = {
  CLIENT_INITIATED: 1,
  DUPLICATE_IDENTITY: 2,
  PARTICIPANT_REMOVED: 4,
  ROOM_DELETED: 5,
  ROOM_CLOSED: 10,
} as const satisfies {
  CLIENT_INITIATED: DisconnectReason.CLIENT_INITIATED;
  DUPLICATE_IDENTITY: DisconnectReason.DUPLICATE_IDENTITY;
  PARTICIPANT_REMOVED: DisconnectReason.PARTICIPANT_REMOVED;
  ROOM_DELETED: DisconnectReason.ROOM_DELETED;
  ROOM_CLOSED: DisconnectReason.ROOM_CLOSED;
};

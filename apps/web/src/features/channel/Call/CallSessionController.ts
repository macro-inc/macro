import type { BackgroundEffect } from '@core/media/background-effect';
import type { CallTokenResponse } from '@service-call/client';
import type { NativeCallState } from './native-call-state';
import {
  endCallKitCall,
  isNativeCallEnabled,
  startNativeCallKitOutgoingCall,
  syncNativeCallStateAfterLeave,
} from './use-callkit';

type CallSessionControllerOptions = {
  nativeCall: NativeCallState | undefined;
  jsConnect: (
    tokenResponse: CallTokenResponse,
    metadata?: CallSessionConnectMetadata
  ) => Promise<void>;
  jsDisconnect: (options?: CallSessionDisconnectOptions) => Promise<void>;
  clearOptimisticJoin: () => void;
};

/** Live capture tracks acquired before joining, e.g. by a waiting room. */
export type CallPrejoinTracks = {
  microphone?: MediaStreamTrack;
  camera?: MediaStreamTrack;
};

export function stopPrejoinTracks(tracks: CallPrejoinTracks | undefined) {
  tracks?.microphone?.stop();
  tracks?.camera?.stop();
}

export type CallSessionConnectMetadata = {
  channelTitle?: string | null;
  microphoneEnabled?: boolean;
  cameraEnabled?: boolean;
  microphoneDeviceId?: string;
  cameraDeviceId?: string;
  speakerDeviceId?: string;
  backgroundEffect?: BackgroundEffect;
  /** Session-owned tracks: reuse without prompting again, or stop if unused. */
  localTracks?: CallPrejoinTracks;
  /** Public meeting pages use the browser media controls on every platform. */
  useBrowserSession?: boolean;
  /**
   * Runs a meeting on native media under this key instead of a channel id;
   * see `native-call-key.ts`.
   */
  nativeCallKey?: string;
  /** Reconnects and restored visits must not announce a new participant. */
  recovery?: boolean;
};

export type CallSessionDisconnectOptions = {
  endNativeCall?: boolean;
};

export type CallSessionController = {
  shouldRequestToken: (channelId: string) => boolean;
  connectWithToken: (
    tokenResponse: CallTokenResponse,
    metadata?: CallSessionConnectMetadata
  ) => Promise<void>;
  disconnect: (options?: CallSessionDisconnectOptions) => Promise<void>;
};

export type CallMediaPath = 'native' | 'browser';

/**
 * Where a call's media runs when native calls are available: channel calls
 * and meetings given a native key go native; channel-less tokens and pages
 * that ask for browser media stay in the web view.
 */
export function nativeCallMediaPath(
  token: Pick<CallTokenResponse, 'channelId'>,
  metadata: CallSessionConnectMetadata | undefined
): CallMediaPath {
  if (metadata?.useBrowserSession) return 'browser';
  if (metadata?.nativeCallKey) return 'native';
  return token.channelId === null ? 'browser' : 'native';
}

/** How long a meeting waits for native to report the call it started. */
export const NATIVE_MEETING_START_TIMEOUT_MS = 15_000;

export function createCallSessionController(
  options: CallSessionControllerOptions
): CallSessionController {
  const browser = createJsLivekitSessionController(options);
  if (isNativeCallEnabled()) {
    if (!options.nativeCall) {
      throw new Error(
        'Native call state is required for iOS CallKit call sessions'
      );
    }
    const native = createNativeCallKitSessionController({
      nativeCall: options.nativeCall,
      jsDisconnect: options.jsDisconnect,
      clearOptimisticJoin: options.clearOptimisticJoin,
    });
    let active = native;
    return {
      shouldRequestToken: native.shouldRequestToken,
      connectWithToken: (token, metadata) => {
        active =
          nativeCallMediaPath(token, metadata) === 'native' ? native : browser;
        return active.connectWithToken(token, metadata);
      },
      disconnect: (disconnectOptions) => active.disconnect(disconnectOptions),
    };
  }

  return browser;
}

function createJsLivekitSessionController(options: {
  jsConnect: (
    tokenResponse: CallTokenResponse,
    metadata?: CallSessionConnectMetadata
  ) => Promise<void>;
  jsDisconnect: (options?: CallSessionDisconnectOptions) => Promise<void>;
}): CallSessionController {
  return {
    shouldRequestToken: () => true,
    connectWithToken: (tokenResponse, metadata) =>
      options.jsConnect(tokenResponse, metadata),
    disconnect: (disconnectOptions) => options.jsDisconnect(disconnectOptions),
  };
}

function createNativeCallKitSessionController(options: {
  nativeCall: NativeCallState;
  jsDisconnect: () => Promise<void>;
  clearOptimisticJoin: () => void;
}): CallSessionController {
  let pendingMeetingStart: AbortController | undefined;
  return {
    shouldRequestToken: (channelId) => {
      const native = options.nativeCall.snapshot();
      const shouldSkip =
        native !== null &&
        native.channelId === channelId &&
        native.connectionState !== 'disconnected' &&
        native.connectionState !== 'disconnecting';

      if (shouldSkip) {
        console.info(
          '[callkit] native call snapshot matched; skipping JS connect',
          {
            channelId,
            callId: native.callId,
            connectionState: native.connectionState,
          }
        );
      }

      return !shouldSkip;
    },
    connectWithToken: async (tokenResponse, metadata) => {
      // The native call captures its own media.
      stopPrejoinTracks(metadata?.localTracks);
      const key = metadata?.nativeCallKey ?? tokenResponse.channelId;
      if (!key) {
        throw new Error('Native calls require a channel or a meeting key');
      }
      const channelTitle = metadata?.channelTitle ?? null;
      await startNativeCallKitOutgoingCall(
        {
          channelId: key,
          callId: tokenResponse.callId,
          channelTitle,
          callerName: channelTitle,
          serverUrl: tokenResponse.serverUrl,
          token: tokenResponse.token,
        },
        options.nativeCall
      );
      options.clearOptimisticJoin();

      // A meeting reads the active call id as soon as connect resolves (to
      // show the call, keep it across pages, and ring invitees), and native
      // reports it only in its first snapshot. Channel calls are tracked by
      // the call lifecycle instead.
      if (metadata?.nativeCallKey) {
        pendingMeetingStart?.abort();
        const start = new AbortController();
        pendingMeetingStart = start;
        try {
          await nativeCallReported(
            options.nativeCall,
            tokenResponse.callId,
            NATIVE_MEETING_START_TIMEOUT_MS,
            start.signal
          );
        } catch (error) {
          // A leave that cancelled the wait ends the call itself. A timeout
          // ends it only while it is still this meeting's call.
          if (
            !start.signal.aborted &&
            options.nativeCall.activeChannelId() === key
          ) {
            await endCallKitCall();
          }
          throw error;
        } finally {
          if (pendingMeetingStart === start) pendingMeetingStart = undefined;
        }
      }
    },
    disconnect: async (disconnectOptions) => {
      pendingMeetingStart?.abort();
      // Captured before any teardown: the post-leave sync may clear exactly
      // this state — a newer call's state appearing mid-leave must survive.
      const stateBeforeLeave = {
        snapshot: options.nativeCall.snapshot(),
        bootstrapChannelId: options.nativeCall.bootstrapChannelId(),
      };
      if (disconnectOptions?.endNativeCall !== false) {
        try {
          await endCallKitCall();
        } catch (e) {
          console.error('callkit: failed to dismiss call sheet', e);
        }
      }
      try {
        await options.jsDisconnect();
      } finally {
        options.clearOptimisticJoin();
        // If the native call was already gone (orphaned in-call state), no
        // disconnect event will arrive to clear the snapshot — reconcile with
        // the plugin so leave always lands in a consistent state, even when
        // the JS disconnect throws.
        try {
          await syncNativeCallStateAfterLeave(
            options.nativeCall,
            stateBeforeLeave
          );
        } catch (e) {
          console.error('callkit: post-leave state sync failed', e);
        }
      }
    },
  };
}

/** Resolves once native reports `callId` as its live call. */
function nativeCallReported(
  nativeCall: Pick<NativeCallState, 'onSnapshot'>,
  callId: string,
  timeoutMs: number,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    const cancel = () => finish(new Error('Native call start cancelled'));
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      unsubscribe?.();
      if (error) reject(error);
      else resolve();
    };
    signal.addEventListener('abort', cancel);
    const timer = setTimeout(
      () => finish(new Error('Native call did not start')),
      timeoutMs
    );

    // onSnapshot reports the current snapshot before it returns.
    unsubscribe = nativeCall.onSnapshot((snapshot) => {
      if (
        snapshot !== null &&
        snapshot.callId.toLowerCase() === callId.toLowerCase() &&
        snapshot.connectionState !== 'disconnected' &&
        snapshot.connectionState !== 'disconnecting'
      ) {
        finish();
      }
    });
    if (settled) unsubscribe();
  });
}

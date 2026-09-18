import type { CallTokenResponse } from '@service-call/client';
import type { NativeCallState } from './native-call-state';
import {
  endCallKitCall,
  isNativeIosCallKitEnabled,
  startNativeCallKitOutgoingCall,
  syncNativeCallStateAfterLeave,
} from './use-callkit';

type CallSessionControllerOptions = {
  nativeCall: NativeCallState | undefined;
  jsConnect: (
    tokenResponse: CallTokenResponse,
    metadata?: CallSessionConnectMetadata
  ) => Promise<void>;
  jsDisconnect: () => Promise<void>;
  clearOptimisticJoin: () => void;
};

export type CallSessionConnectMetadata = {
  channelTitle?: string | null;
  microphoneEnabled?: boolean;
  cameraEnabled?: boolean;
  /** Public meeting pages use the browser media controls on every platform. */
  useBrowserSession?: boolean;
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

export function createCallSessionController(
  options: CallSessionControllerOptions
): CallSessionController {
  const browser = createJsLivekitSessionController(options);
  if (isNativeIosCallKitEnabled()) {
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
          token.channelId === null || metadata?.useBrowserSession
            ? browser
            : native;
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
  jsDisconnect: () => Promise<void>;
}): CallSessionController {
  return {
    shouldRequestToken: () => true,
    connectWithToken: (tokenResponse, metadata) =>
      options.jsConnect(tokenResponse, metadata),
    disconnect: () => options.jsDisconnect(),
  };
}

function createNativeCallKitSessionController(options: {
  nativeCall: NativeCallState;
  jsDisconnect: () => Promise<void>;
  clearOptimisticJoin: () => void;
}): CallSessionController {
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
      if (!tokenResponse.channelId) {
        throw new Error('Native channel calls require a channel');
      }
      const channelTitle = metadata?.channelTitle ?? null;
      await startNativeCallKitOutgoingCall(
        {
          channelId: tokenResponse.channelId,
          callId: tokenResponse.callId,
          channelTitle,
          callerName: channelTitle,
          serverUrl: tokenResponse.serverUrl,
          token: tokenResponse.token,
        },
        options.nativeCall
      );
      options.clearOptimisticJoin();
    },
    disconnect: async (disconnectOptions) => {
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

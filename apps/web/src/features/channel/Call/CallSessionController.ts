import type { CallTokenResponse } from '@service-call/client';
import type { NativeCallState } from './native-call-state';
import {
  endCallKitCall,
  isNativeIosCallKitEnabled,
  startNativeCallKitOutgoingCall,
} from './use-callkit';

type CallSessionControllerOptions = {
  nativeCall: NativeCallState | undefined;
  jsConnect: (tokenResponse: CallTokenResponse) => Promise<void>;
  jsDisconnect: () => Promise<void>;
  clearOptimisticJoin: () => void;
};

export type CallSessionConnectMetadata = {
  channelTitle?: string | null;
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
  if (isNativeIosCallKitEnabled()) {
    if (!options.nativeCall) {
      throw new Error(
        'Native call state is required for iOS CallKit call sessions'
      );
    }
    return createNativeCallKitSessionController({
      nativeCall: options.nativeCall,
      jsDisconnect: options.jsDisconnect,
      clearOptimisticJoin: options.clearOptimisticJoin,
    });
  }

  return createJsLivekitSessionController({
    jsConnect: options.jsConnect,
    jsDisconnect: options.jsDisconnect,
  });
}

function createJsLivekitSessionController(options: {
  jsConnect: (tokenResponse: CallTokenResponse) => Promise<void>;
  jsDisconnect: () => Promise<void>;
}): CallSessionController {
  return {
    shouldRequestToken: () => true,
    connectWithToken: (tokenResponse) => options.jsConnect(tokenResponse),
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
      if (disconnectOptions?.endNativeCall !== false) {
        try {
          await endCallKitCall();
        } catch (e) {
          console.error('callkit: failed to dismiss call sheet', e);
        }
      }
      await options.jsDisconnect();
      options.clearOptimisticJoin();
    },
  };
}

import type {
  CallMediaPath,
  CallSessionConnectMetadata,
} from '@channel/Call/CallSessionController';
import { meetingNativeCallKey } from '@channel/Call/native-call-key';
import { isNativeIosCallKitEnabled } from '@channel/Call/native-call-platform';

/**
 * Members in the iOS app run meetings on native CallKit media, like channel
 * calls, because iOS suspends the web view's media when the app is in the
 * background. Guests, the web, desktop and Android keep browser media.
 */
export function meetingMediaPath(authenticated: boolean): CallMediaPath {
  return authenticated && isNativeIosCallKitEnabled() ? 'native' : 'browser';
}

/** How a meeting asks the call session for the media path it chose. */
export function meetingConnectMetadata(
  path: CallMediaPath,
  call: { callId: string; title: string }
): Pick<
  CallSessionConnectMetadata,
  'useBrowserSession' | 'nativeCallKey' | 'channelTitle'
> {
  if (path === 'browser') return { useBrowserSession: true };
  return {
    nativeCallKey: meetingNativeCallKey(call.callId),
    // The system call screen shows the key when there is no title.
    channelTitle: call.title.trim() || 'Call',
  };
}

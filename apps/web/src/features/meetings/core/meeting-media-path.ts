import type {
  CallMediaPath,
  CallSessionConnectMetadata,
} from '@channel/Call/CallSessionController';
import { meetingNativeCallKey } from '@channel/Call/native-call-key';
import { URL_PARAMS } from '@channel/Channel/link';

/**
 * Members in the iOS app run meetings on native CallKit media, like channel
 * calls, because iOS suspends the web view's media when the app is in the
 * background. Guests, the web, desktop and Android keep browser media.
 * A channel-linked meeting is its channel's own call, which the channel
 * tracks by its channel id, so it keeps browser media here: a live one is
 * joined in its channel instead (`channelCallHandoffPath`).
 */
export function meetingMediaPath(meeting: {
  member: boolean;
  channelId: string | null;
  nativeIosCalls: boolean;
}): CallMediaPath {
  if (!meeting.nativeIosCalls || !meeting.member) return 'browser';
  return meeting.channelId === null ? 'native' : 'browser';
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

/**
 * Where a member's link to a live channel-linked meeting joins in the iOS
 * app: the channel's own native join, as from the channel, so the call keeps
 * going in the background. Undefined when the meeting page joins it.
 */
export function channelCallHandoffPath(meeting: {
  member: boolean;
  nativeIosCalls: boolean;
  channelId: string | null;
  callId: string | null;
}): string | undefined {
  if (!meeting.nativeIosCalls || !meeting.member) return undefined;
  if (!meeting.channelId || !meeting.callId) return undefined;
  const channel = encodeURIComponent(meeting.channelId);
  const call = encodeURIComponent(meeting.callId);
  return `/channel/${channel}?${URL_PARAMS.joinCall}=${call}`;
}

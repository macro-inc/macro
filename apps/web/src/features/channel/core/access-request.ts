import type { ChannelAccessRequestState } from '@service-storage/generated/schemas/channelAccessRequestState';

/** What someone outside a channel can do about joining it. */
export type RequestToJoinView =
  | { kind: 'ask' }
  | { kind: 'pending' }
  | { kind: 'denied'; retryAfter: string }
  | { kind: 'wait'; retryAfter: string };

/**
 * Public channels are already open and direct messages never gain members, so
 * they offer nothing. An approval from before the person left the channel
 * lets them ask again.
 */
export function requestToJoinView(
  state: ChannelAccessRequestState
): RequestToJoinView | undefined {
  if (!state.can_request) return undefined;
  const status = state.request?.status;
  if (status === 'pending') return { kind: 'pending' };
  if (state.retry_after)
    return status === 'denied'
      ? { kind: 'denied', retryAfter: state.retry_after }
      : { kind: 'wait', retryAfter: state.retry_after };
  return { kind: 'ask' };
}

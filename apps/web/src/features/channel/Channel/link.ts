// These constants intentionally duplicate block-channel/constants.ts and
// block-channel/utils/link.ts. The `channel` package is being migrated to
// replace `block-channel`, and we don't want `channel` to import from
// `block-channel` to keep the import tree clean during the transition.

import type { ChannelTargetRequest } from './ChannelSurface';

export const URL_PARAMS = {
  thread: 'channel_thread_id',
  message: 'channel_message_id',
  joinCall: 'join_call',
  /** Switch to the Call tab without starting a join (e.g. sidebar → full call UI). */
  openCallTab: 'open_call_tab',
};

export function getChannelParams(
  messageId: string,
  threadId?: string | null
): Record<string, string> {
  const params: Record<string, string> = {};
  params[URL_PARAMS.message] = messageId;

  if (threadId) {
    params[URL_PARAMS.thread] = threadId;
  }

  return params;
}

/**
 * Decode channel target params into a surface request. A bare `thread` param
 * becomes a request whose message is the thread root itself, which the surface
 * collapses to a top-level target.
 */
export function toChannelTargetRequest(
  params: Record<string, unknown>
): ChannelTargetRequest | undefined {
  const messageId = params[URL_PARAMS.message];
  const threadId = params[URL_PARAMS.thread];
  const primary = typeof messageId === 'string' ? messageId : undefined;
  const thread = typeof threadId === 'string' ? threadId : undefined;
  const target = primary ?? thread;
  if (!target) return undefined;
  return {
    kind: 'message',
    messageId: target,
    ...(thread ? { threadId: thread } : {}),
  };
}

/** True when a `join_call` param value means "please join the call". */
export function isJoinCallRequested(value: unknown): boolean {
  return value === 'true' || value === true;
}

/** True when we should only show the Call tab (already in / joining call). */
export function isOpenCallTabRequested(value: unknown): boolean {
  return value === 'true' || value === true;
}

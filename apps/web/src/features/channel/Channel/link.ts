// These constants intentionally duplicate block-channel/constants.ts and
// block-channel/utils/link.ts. The `channel` package is being migrated to
// replace `block-channel`, and we don't want `channel` to import from
// `block-channel` to keep the import tree clean during the transition.

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

/** True when a `join_call` param value means "please join the call". */
export function isJoinCallRequested(value: unknown): boolean {
  return value === 'true' || value === true;
}

/** True when we should only show the Call tab (already in / joining call). */
export function isOpenCallTabRequested(value: unknown): boolean {
  return value === 'true' || value === true;
}

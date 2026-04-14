// These constants intentionally duplicate block-channel/constants.ts and
// block-channel/utils/link.ts. The `channel` package is being migrated to
// replace `block-channel`, and we don't want `channel` to import from
// `block-channel` to keep the import tree clean during the transition.

export const URL_PARAMS = {
  thread: 'channel_thread_id',
  message: 'channel_message_id',
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

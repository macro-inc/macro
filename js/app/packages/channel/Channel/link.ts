// matches block-channel/constants.ts
export const URL_PARAMS = {
  thread: 'channel_thread_id',
  message: 'channel_message_id',
};

// also defined in block-channel/utils/link.ts
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

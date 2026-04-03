import { URL_PARAMS } from '@block-channel/constants';

export function getChannelParams(
  messageId: string,
  threadId?: string
): Record<string, string> {
  const params: Record<string, string> = {};
  params[URL_PARAMS.message] = messageId;

  if (threadId) {
    params[URL_PARAMS.thread] = threadId;
  }

  return params;
}

export function getUrlToMessage(
  channelId: string,
  messageId: string,
  threadId?: string
) {
  const origin = window.location.origin;
  let url = `${origin}/app/channel/${channelId}?${URL_PARAMS.message}=${messageId}`;
  if (threadId) {
    url += `&${URL_PARAMS.thread}=${threadId}`;
  }
  return url;
}

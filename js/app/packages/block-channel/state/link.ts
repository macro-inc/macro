import { URL_PARAMS } from '@block-channel/constants';

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

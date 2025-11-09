export function getUrlToMessage(
  channelId: string,
  messageId: string,
  threadId?: string
) {
  const origin = window.location.origin;
  let url = `${origin}/app/channel/${channelId}?message_id=${messageId}`;
  if (threadId) {
    url += `&thread_id=${threadId}`;
  }
  return url;
}

export type ReplyType = 'reply' | 'reply-all' | 'forward';

export const FORWARDED_MESSAGE_HEADER =
  '---------- Forwarded message ----------';

/**
 * Whether an email body forwards a message. Provider sync rewrites markup, so
 * this reads the header's text; a header inside a quote belongs to the quoted
 * message.
 */
export function forwardsMessage(html: string) {
  const { body } = new DOMParser().parseFromString(html, 'text/html');
  for (const quote of body.querySelectorAll('blockquote')) quote.remove();
  return body.textContent?.includes(FORWARDED_MESSAGE_HEADER) ?? false;
}

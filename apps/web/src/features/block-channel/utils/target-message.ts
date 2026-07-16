import { URL_PARAMS } from '@block-channel/constants';

/** Channel navigation params: a message id, optionally within a thread root. */
export type ChannelTargetParams = {
  [URL_PARAMS.message]?: string;
  [URL_PARAMS.thread]?: string;
};

/** The message the channel block should activate. */
export type ChannelMessageTarget = {
  targetMessageId?: string;
  targetMessageReplyId?: string;
};

/**
 * Decode channel target params (`{message, thread}`) into the block's target.
 *
 * The params encode a reply as `message` (the reply) within `thread` (its
 * root); a bare `message` with no `thread` is a top-level message. A message
 * whose thread root is itself (`thread === message`) is therefore also a
 * top-level message, not a reply — every thread root satisfies this in the
 * entity model. Sending it as a reply-within-itself matches neither the root
 * nor any real reply, so nothing scrolls or highlights; collapse it to a
 * top-level target here, the one place these params are decoded, so every
 * caller (URLs, mentions, search hits, notifications) is covered.
 */
export function convertTargetMessage(
  params: ChannelTargetParams
): ChannelMessageTarget {
  const messageId = params[URL_PARAMS.message];
  const rawThreadId = params[URL_PARAMS.thread];
  const threadId = rawThreadId === messageId ? undefined : rawThreadId;

  // New channels index by top-level message and handle replies separately:
  // when a thread is present it is the top-level message and message is the
  // reply.
  const topLevelMessageId = threadId ? threadId : messageId;
  const messageReplyId = threadId ? messageId : threadId;

  return {
    targetMessageId: topLevelMessageId,
    targetMessageReplyId: messageReplyId,
  };
}

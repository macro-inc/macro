import { deferredGate } from '@core/util/debounce';
import type { Accessor } from 'solid-js';
import { DEFAULT_VISIBLE_REPLY_COUNT } from './utils/thread-reply-indicator-helpers';

export const THREAD_REPLIES_FETCH_DEBOUNCE_MS = 300;

type CreateThreadRepliesFetchGateOptions = {
  threadId: Accessor<string>;
  replyCount: Accessor<number>;
  isExpanded: Accessor<boolean>;
  isFindBarOpen: Accessor<boolean>;
  targetThreadId: Accessor<string | undefined>;
  targetReplyId: Accessor<string | undefined>;
};

/**
 * Delays reply fetching long enough for transiently mounted threads to unmount.
 * Cmd+F navigation is the only immediate path because it needs the targeted
 * reply list before it can position the active search result.
 */
export function createThreadRepliesFetchGate(
  options: CreateThreadRepliesFetchGateOptions
): Accessor<boolean> {
  const isTargetedReply = () =>
    !!options.targetReplyId() &&
    options.targetThreadId() === options.threadId();
  const shouldFetchReplies = () =>
    isTargetedReply() ||
    options.isExpanded() ||
    options.replyCount() > DEFAULT_VISIBLE_REPLY_COUNT;
  const debouncedFetchReplies = deferredGate(
    shouldFetchReplies,
    THREAD_REPLIES_FETCH_DEBOUNCE_MS
  );

  return () =>
    (options.isFindBarOpen() && isTargetedReply()) || debouncedFetchReplies();
}

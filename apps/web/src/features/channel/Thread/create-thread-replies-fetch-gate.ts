import { deferredGate } from '@core/util/debounce';
import type { Accessor } from 'solid-js';

export const THREAD_REPLIES_FETCH_DEBOUNCE_MS = 300;

type CreateThreadRepliesFetchGateOptions = {
  threadId: Accessor<string>;
  isExpanded: Accessor<boolean>;
  isFindBarOpen: Accessor<boolean>;
  targetThreadId: Accessor<string | undefined>;
  targetReplyId: Accessor<string | undefined>;
};

/**
 * Collapsed threads use their timeline preview without fetching full replies.
 * Debounces reply-target navigation while transient virtualized rows unmount.
 * Explicit expansion and Cmd+F targeting enable immediately — those are user
 * intent, not transient mounts.
 */
export function createThreadRepliesFetchGate(
  options: CreateThreadRepliesFetchGateOptions
): Accessor<boolean> {
  const isTargetedReply = () =>
    !!options.targetReplyId() &&
    options.targetThreadId() === options.threadId();
  const shouldFetchReplies = () => isTargetedReply() || options.isExpanded();
  const debouncedFetchReplies = deferredGate(
    shouldFetchReplies,
    THREAD_REPLIES_FETCH_DEBOUNCE_MS
  );

  return () =>
    options.isExpanded() ||
    (options.isFindBarOpen() && isTargetedReply()) ||
    debouncedFetchReplies();
}

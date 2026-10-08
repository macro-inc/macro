import type { ThreadReplyListHandle } from './ThreadReplyList';

type Reply = { id: string };

type TargetReplyNavigation = {
  requestKey?: string | number;
  targetReplyId?: string;
  handle?: ThreadReplyListHandle;
  canScroll: boolean;
  replies: readonly Reply[];
  getCurrentTargetReplyId: () => string | undefined;
  onScrolled?: (replyId: string) => void;
};

/** Coordinates one-shot reply navigation across async target changes. */
export function createTargetReplyNavigationController() {
  let currentRequestKey: string | number | undefined;
  let requestGeneration = 0;
  let lastScrolledReplyId: string | undefined;
  let inFlightReplyId: string | undefined;
  let inFlightHandle: ThreadReplyListHandle | undefined;

  const clearInFlight = () => {
    inFlightReplyId = undefined;
    inFlightHandle = undefined;
  };

  const cancelInFlight = () => {
    inFlightHandle?.cancelScroll();
    clearInFlight();
  };

  const update = ({
    requestKey,
    targetReplyId,
    handle,
    canScroll,
    replies,
    getCurrentTargetReplyId,
    onScrolled,
  }: TargetReplyNavigation) => {
    if (currentRequestKey !== requestKey) {
      cancelInFlight();
      lastScrolledReplyId = undefined;
      currentRequestKey = requestKey;
      requestGeneration += 1;
    }
    if (inFlightReplyId && inFlightReplyId !== targetReplyId) {
      cancelInFlight();
    }

    if (!targetReplyId) {
      if (inFlightHandle) cancelInFlight();
      else handle?.cancelScroll();
      lastScrolledReplyId = undefined;
      return;
    }
    if (lastScrolledReplyId === targetReplyId) return;
    if (!canScroll || !handle) return;

    const index = replies.findIndex((reply) => reply.id === targetReplyId);
    if (index === -1) return;

    if (inFlightHandle && inFlightHandle !== handle) cancelInFlight();
    inFlightReplyId = targetReplyId;
    inFlightHandle = handle;
    const generation = requestGeneration;
    const started = handle.scrollToIndex(index, () => {
      if (generation !== requestGeneration) return;
      if (inFlightReplyId === targetReplyId && inFlightHandle === handle) {
        clearInFlight();
      }
      if (getCurrentTargetReplyId() !== targetReplyId) return;
      lastScrolledReplyId = targetReplyId;
      onScrolled?.(targetReplyId);
    });
    if (
      !started &&
      inFlightReplyId === targetReplyId &&
      inFlightHandle === handle
    ) {
      clearInFlight();
    }
  };

  return { update, dispose: cancelInFlight };
}

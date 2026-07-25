import { describe, expect, it, vi } from 'vitest';
import { createTargetReplyNavigationController } from '../create-target-reply-navigation-controller';
import type { ThreadReplyListHandle } from '../ThreadReplyList';

function createHandle() {
  let settle = () => {};
  const handle: ThreadReplyListHandle = {
    scrollToIndex: vi.fn((_index, onSettled) => {
      settle = onSettled;
      return true;
    }),
    cancelScroll: vi.fn(),
  };
  return { handle, settle: () => settle() };
}

describe('createTargetReplyNavigationController', () => {
  it('cancels target A before returning while target B is unavailable', () => {
    const controller = createTargetReplyNavigationController();
    const first = createHandle();
    const onScrolled = vi.fn();
    let currentTargetReplyId: string | undefined = 'reply-a';

    controller.update({
      targetReplyId: currentTargetReplyId,
      handle: first.handle,
      canScroll: true,
      replies: [{ id: 'reply-a' }],
      getCurrentTargetReplyId: () => currentTargetReplyId,
      onScrolled,
    });
    expect(first.handle.scrollToIndex).toHaveBeenCalledWith(
      0,
      expect.any(Function)
    );

    currentTargetReplyId = 'reply-b';
    controller.update({
      targetReplyId: currentTargetReplyId,
      handle: first.handle,
      canScroll: false,
      replies: [],
      getCurrentTargetReplyId: () => currentTargetReplyId,
      onScrolled,
    });

    expect(first.handle.cancelScroll).toHaveBeenCalledOnce();
    first.settle();
    expect(onScrolled).not.toHaveBeenCalled();
  });
});

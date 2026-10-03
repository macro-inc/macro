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
  it('revisits a settled reply only for a new navigation request', () => {
    const controller = createTargetReplyNavigationController();
    const { handle, settle } = createHandle();
    const options = {
      targetReplyId: 'reply',
      handle,
      canScroll: true,
      replies: [{ id: 'reply' }],
      getCurrentTargetReplyId: () => 'reply',
    };

    controller.update({ ...options, requestKey: 'first' });
    settle();
    controller.update({ ...options, requestKey: 'first' });
    expect(handle.scrollToIndex).toHaveBeenCalledTimes(1);
    controller.update({ ...options, requestKey: 'again' });
    expect(handle.scrollToIndex).toHaveBeenCalledTimes(2);
  });

  it('ignores a cancelled request settling after the same reply is requested again', () => {
    const controller = createTargetReplyNavigationController();
    const { handle, settle } = createHandle();
    const onScrolled = vi.fn();
    const options = {
      targetReplyId: 'reply',
      handle,
      canScroll: true,
      replies: [{ id: 'reply' }],
      getCurrentTargetReplyId: () => 'reply',
      onScrolled,
    };
    controller.update({ ...options, requestKey: 1 });
    const staleSettlement = vi.mocked(handle.scrollToIndex).mock.calls[0][1];
    controller.update({ ...options, requestKey: 2 });
    expect(handle.cancelScroll).toHaveBeenCalledOnce();

    staleSettlement();
    expect(onScrolled).not.toHaveBeenCalled();
    settle();
    expect(onScrolled).toHaveBeenCalledExactlyOnceWith('reply');
  });

  it('invalidates an earlier request even when its key is reused after clearing', () => {
    const controller = createTargetReplyNavigationController();
    const { handle, settle } = createHandle();
    const onScrolled = vi.fn();
    const options = {
      targetReplyId: 'reply',
      requestKey: 1,
      handle,
      canScroll: true,
      replies: [{ id: 'reply' }],
      getCurrentTargetReplyId: () => 'reply',
      onScrolled,
    };
    controller.update(options);
    const staleSettlement = vi.mocked(handle.scrollToIndex).mock.calls[0][1];
    controller.update({
      ...options,
      targetReplyId: undefined,
      requestKey: undefined,
    });
    controller.update(options);

    staleSettlement();
    expect(onScrolled).not.toHaveBeenCalled();
    settle();
    expect(onScrolled).toHaveBeenCalledExactlyOnceWith('reply');
  });

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

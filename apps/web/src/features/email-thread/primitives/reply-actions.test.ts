import { describe, expect, it, vi } from 'vitest';
import { message } from '../tests/fixtures';
import type { EmailThreadState } from './email-thread-state';
import { openEmailReplyComposerForMessage } from './reply-actions';

function setup(permissions = { isOwner: true, canReply: true }) {
  const ctx = {
    permissions: () => permissions,
    replyRequest: { set: vi.fn() },
    mobileReplyComposer: { openForMessage: vi.fn() },
    messages: {
      setBottomReplyOpen: vi.fn(),
      setExpandedBodyId: vi.fn(),
      setFocused: vi.fn(),
      setReplyingToMessageId: vi.fn(),
    },
  };
  return { ctx, state: ctx as unknown as EmailThreadState };
}

describe('openEmailReplyComposerForMessage', () => {
  // Tablets are touch at desktop widths. The inline reply input never renders
  // on touch, so replying there must open the full-screen composer.
  it('opens the full-screen composer on touch', () => {
    const { ctx, state } = setup();

    openEmailReplyComposerForMessage({
      ctx: state,
      isTouch: true,
      message: message('last'),
      replyType: 'reply-all',
      isLastMessage: true,
    });

    expect(ctx.replyRequest.set).toHaveBeenCalledWith('last', 'reply-all');
    expect(ctx.mobileReplyComposer.openForMessage).toHaveBeenCalledWith('last');
    expect(ctx.messages.setBottomReplyOpen).not.toHaveBeenCalled();
  });

  it('opens the inline reply input without touch', () => {
    const { ctx, state } = setup();

    openEmailReplyComposerForMessage({
      ctx: state,
      isTouch: false,
      message: message('last'),
      replyType: 'forward',
      isLastMessage: true,
    });

    expect(ctx.mobileReplyComposer.openForMessage).not.toHaveBeenCalled();
    expect(ctx.messages.setBottomReplyOpen).toHaveBeenCalledWith(true);
  });

  it('lets an edit recipient of a shared thread reply but not forward', () => {
    const { ctx, state } = setup({ isOwner: false, canReply: true });
    const open = (replyType: 'reply-all' | 'forward') =>
      openEmailReplyComposerForMessage({
        ctx: state,
        isTouch: false,
        message: message('last'),
        replyType,
        isLastMessage: true,
      });

    expect(open('forward')).toBe(false);
    expect(ctx.replyRequest.set).not.toHaveBeenCalled();
    expect(open('reply-all')).toBe(true);
    expect(ctx.replyRequest.set).toHaveBeenCalledWith('last', 'reply-all');
  });

  it('opens nothing for a view-only recipient', () => {
    const { ctx, state } = setup({ isOwner: false, canReply: false });

    const opened = openEmailReplyComposerForMessage({
      ctx: state,
      isTouch: true,
      message: message('last'),
      replyType: 'reply-all',
      isLastMessage: true,
    });

    expect(opened).toBe(false);
    expect(ctx.mobileReplyComposer.openForMessage).not.toHaveBeenCalled();
  });
});

import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createThreadContext, message, thread } from '../tests/fixtures';
import { createEmailThreadState } from './email-thread-state';
import { openEmailReplyComposerForMessage } from './reply-actions';

describe('openEmailReplyComposerForMessage', () => {
  it('opens the drawer and retains a suggested body on touch layouts', () =>
    createRoot((dispose) => {
      const target = message('message');
      const state = createEmailThreadState(
        createThreadContext({ thread: () => thread([target]) })
      );

      expect(
        openEmailReplyComposerForMessage({
          ctx: state,
          useReplyDrawer: true,
          message: target,
          replyType: 'reply-all',
          suggestedBody: 'Suggested response',
          isLastMessage: true,
        })
      ).toBe(true);

      expect(state.mobileReplyComposer.open()).toBe(true);
      expect(state.mobileReplyComposer.messageId()).toBe('message');
      expect(state.messages.bottomReplyOpen()).toBe(false);
      expect(state.replyRequest.suggestedBody()).toBe('Suggested response');
      dispose();
    }));
});

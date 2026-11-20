import { describe, expect, it } from 'vitest';
import {
  isTopLevelChannelNotification,
  isUnreadChannelMessageNotification,
  isUnseenChannelInvite,
} from './top-level-channel-notification';
import type { UnifiedNotification } from './types';

describe('top-level channel notifications', () => {
  it.each([
    ['channel_message_send', undefined, true],
    ['channel_mention', undefined, true],
    ['channel_mention', 'root', false],
    ['channel_message_reaction', undefined, true],
    ['channel_message_reaction', 'root', false],
    ['document_mention', undefined, true],
    ['document_mention', 'root', false],
    ['channel_message_reply', 'root', false],
    ['channel_invite', undefined, true],
    ['call_started', undefined, false],
  ] as const)(
    'classifies %s with thread %s as %s',
    (tag, threadId, expected) => {
      const notification_metadata = {
        tag,
        content: { messageId: 'message', threadId },
      } as UnifiedNotification['notification_metadata'];
      expect(isTopLevelChannelNotification({ notification_metadata })).toBe(
        expected
      );
      expect(
        isUnreadChannelMessageNotification({ notification_metadata })
      ).toBe(expected && tag !== 'channel_message_reaction');
    }
  );

  it.each([
    ['channel_invite', 'unseen', true],
    ['channel_invite', 'seen', false],
    ['channel_invite', 'done', false],
    ['channel_message_send', 'unseen', false],
  ] as const)('finds an unseen invite: %s %s is %s', (tag, state, expected) => {
    const notification_metadata = {
      tag,
      content: { messageId: 'message' },
    } as UnifiedNotification['notification_metadata'];
    expect(isUnseenChannelInvite({ state, notification_metadata })).toBe(
      expected
    );
  });
});

import { describe, expect, it } from 'vitest';
import { URL_PARAMS } from '@channel/Channel/link';
import {
  buildMessageLink,
  canEditOrDeleteMessage,
  canReplyToMessage,
  DEFAULT_REACTION_EMOJI,
  hasReactionFromUser,
} from '../utils/message-actions';

describe('message-actions helpers', () => {
  it('allows edit/delete only for own non-deleted messages', () => {
    expect(
      canEditOrDeleteMessage(
        { sender_id: 'user-1', deleted_at: null },
        'user-1'
      )
    ).toBe(true);
    expect(
      canEditOrDeleteMessage(
        { sender_id: 'user-2', deleted_at: null },
        'user-1'
      )
    ).toBe(false);
    expect(
      canEditOrDeleteMessage(
        { sender_id: 'user-1', deleted_at: '2026-02-25T00:00:00.000Z' },
        'user-1'
      )
    ).toBe(false);
  });

  it('allows reply only for non-thread non-deleted messages', () => {
    expect(canReplyToMessage({ thread_id: null, deleted_at: null })).toBe(true);
    expect(
      canReplyToMessage({ thread_id: 'parent-id', deleted_at: null })
    ).toBe(false);
    expect(
      canReplyToMessage({
        thread_id: null,
        deleted_at: '2026-02-25T00:00:00.000Z',
      })
    ).toBe(false);
  });

  it('detects if user already reacted with the default emoji', () => {
    const message = {
      reactions: [
        { emoji: DEFAULT_REACTION_EMOJI, users: ['user-1', 'user-2'] },
        { emoji: '❤️', users: ['user-3'] },
      ],
    };

    expect(hasReactionFromUser(message, DEFAULT_REACTION_EMOJI, 'user-1')).toBe(
      true
    );
    expect(hasReactionFromUser(message, DEFAULT_REACTION_EMOJI, 'user-9')).toBe(
      false
    );
  });

  it('builds message links with channel_message_id param', () => {
    const parsed = new URL(buildMessageLink('channel-123', 'msg-123'));
    expect(parsed.pathname).toBe('/app/channel/channel-123');
    expect(parsed.searchParams.get(URL_PARAMS.message)).toBe('msg-123');
    expect(parsed.searchParams.has(URL_PARAMS.thread)).toBe(false);
  });

  it('builds message links with thread param', () => {
    const parsed = new URL(
      buildMessageLink('channel-123', 'msg-123', 'thread-456')
    );
    expect(parsed.pathname).toBe('/app/channel/channel-123');
    expect(parsed.searchParams.get(URL_PARAMS.message)).toBe('msg-123');
    expect(parsed.searchParams.get(URL_PARAMS.thread)).toBe('thread-456');
  });
});

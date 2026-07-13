import { URL_PARAMS } from '@channel/Channel/link';
import { describe, expect, it } from 'vitest';
import {
  buildMessageLink,
  buildQuoteReplyValue,
  canDeleteMessage,
  canEditMessage,
  canReplyToMessage,
  DEFAULT_REACTION_EMOJI,
  hasReactionFromUser,
} from '../utils/message-actions';

describe('message-actions helpers', () => {
  it('allows edit only for own non-deleted messages', () => {
    expect(
      canEditMessage({ sender_id: 'user-1', deleted_at: null }, 'user-1')
    ).toBe(true);
    expect(
      canEditMessage({ sender_id: 'user-2', deleted_at: null }, 'user-1')
    ).toBe(false);
    expect(
      canEditMessage({ sender_id: 'bot|bot-1', deleted_at: null }, 'user-1')
    ).toBe(false);
    expect(
      canEditMessage(
        { sender_id: 'user-1', deleted_at: '2026-02-25T00:00:00.000Z' },
        'user-1'
      )
    ).toBe(false);
  });

  it('allows delete for own and bot non-deleted messages', () => {
    expect(
      canDeleteMessage({ sender_id: 'user-1', deleted_at: null }, 'user-1')
    ).toBe(true);
    expect(
      canDeleteMessage({ sender_id: 'user-2', deleted_at: null }, 'user-1')
    ).toBe(false);
    expect(
      canDeleteMessage({ sender_id: 'bot|bot-1', deleted_at: null }, 'user-1')
    ).toBe(true);
    expect(
      canDeleteMessage(
        { sender_id: 'bot|bot-1', deleted_at: '2026-02-25T00:00:00.000Z' },
        'user-1'
      )
    ).toBe(false);
  });

  it('allows reply for non-deleted top-level messages and thread replies', () => {
    expect(canReplyToMessage({ thread_id: null, deleted_at: null })).toBe(true);
    expect(
      canReplyToMessage({ thread_id: 'parent-id', deleted_at: null })
    ).toBe(true);
    expect(
      canReplyToMessage({
        thread_id: null,
        deleted_at: '2026-02-25T00:00:00.000Z',
      })
    ).toBe(false);
  });

  it('builds quote reply markdown before existing draft text', () => {
    expect(
      buildQuoteReplyValue({
        quotedContent: 'first line\nsecond line',
        existingValue: 'draft',
      })
    ).toBe('> first line\n> second line\n\ndraft');
  });

  it('does not insert a quote for empty quoted content', () => {
    expect(
      buildQuoteReplyValue({
        quotedContent: '   \n  ',
        existingValue: 'draft',
      })
    ).toBe('draft');
  });

  it('flattens existing quote markers instead of nesting blockquotes', () => {
    expect(
      buildQuoteReplyValue({
        quotedContent: '> first line\n>> second line',
      })
    ).toBe('> first line\n> second line\n\n ');
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

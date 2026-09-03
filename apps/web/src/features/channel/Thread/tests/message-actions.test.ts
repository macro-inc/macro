import { URL_PARAMS } from '@channel/Channel/link';
import { describe, expect, it } from 'vitest';
import {
  buildMessageLink,
  buildReplyTargetValue,
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

  const threadReply = {
    id: 'reply-1',
    content: 'first line\nsecond line',
    sender_id: 'macro|sender@example.com',
    thread_id: 'thread-1',
  };

  it('builds a reply-target node before existing draft text', () => {
    expect(
      buildReplyTargetValue({
        channelId: 'channel-1',
        message: threadReply,
        existingValue: 'draft',
      })
    ).toBe(
      '<m-reply-target>{"channelId":"channel-1","targetMessageId":"reply-1","targetThreadId":"thread-1","displayText":"first line second line","senderId":"macro|sender@example.com"}</m-reply-target>\n\ndraft'
    );
  });

  it('uses browser-selected text for the reply preview', () => {
    expect(
      buildReplyTargetValue({
        channelId: 'channel-1',
        message: threadReply,
        selectedText: 'specific\nselection',
      })
    ).toContain('"displayText":"specific selection"');
  });

  it('uses resolved decorator text for a bot reply preview', () => {
    expect(
      buildReplyTargetValue({
        channelId: 'channel-1',
        message: {
          ...threadReply,
          content:
            '> original prompt\n\n<m-magic-chip>{"agentSessionId":"session-1","promptedMessage":{"turn":0,"author":"user"},"status":"booting"}</m-magic-chip>',
        },
        renderedText: 'The resolved bot response',
      })
    ).toContain('"displayText":"The resolved bot response"');
  });

  it('drops an unresolved magic chip from the fallback preview', () => {
    expect(
      buildReplyTargetValue({
        channelId: 'channel-1',
        message: {
          ...threadReply,
          content:
            '> original prompt\n\n<m-magic-chip>{"agentSessionId":"session-1","promptedMessage":{"turn":0,"author":"user"},"status":"booting"}</m-magic-chip>',
        },
      })
    ).toContain('"displayText":"> original prompt"');
  });

  it('needs rendered text when a reply-target plus magic chip leaves no preview', () => {
    const agentSessionReply = {
      ...threadReply,
      content:
        '<m-reply-target>{"channelId":"channel-1","targetMessageId":"earlier-reply","targetThreadId":"thread-1","displayText":"earlier preview","senderId":"macro|earlier@example.com"}</m-reply-target>\n\n<m-magic-chip>{"agentSessionId":"session-1","promptedMessage":{"turn":0,"author":"user"},"status":"booting"}</m-magic-chip>',
    };

    expect(
      buildReplyTargetValue({
        channelId: 'channel-1',
        message: agentSessionReply,
      })
    ).toContain('"displayText":""');
    expect(
      buildReplyTargetValue({
        channelId: 'channel-1',
        message: agentSessionReply,
        renderedText: 'Resolved bot response',
      })
    ).toContain('"displayText":"Resolved bot response"');
  });

  it('ignores a leading reply-target block in the automatic preview', () => {
    expect(
      buildReplyTargetValue({
        channelId: 'channel-1',
        message: {
          ...threadReply,
          content:
            '<m-reply-target>{"channelId":"channel-1","targetMessageId":"earlier-reply","targetThreadId":"thread-1","displayText":"earlier preview","senderId":"macro|earlier@example.com"}</m-reply-target>\n\nmy response',
        },
      })
    ).toContain('"displayText":"my response"');
  });

  it('does not add a reply-target node for a top-level message', () => {
    expect(
      buildReplyTargetValue({
        channelId: 'channel-1',
        message: { ...threadReply, thread_id: null },
        existingValue: 'draft',
      })
    ).toBe('draft');
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

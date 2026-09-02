import { describe, expect, it } from 'vitest';
import { buildReplyTargetMarkdown } from '../nodes/ReplyTargetNode';
import { isExplicitReplyMarkdown } from '../utils/explicit-reply';

describe('isExplicitReplyMarkdown', () => {
  it('detects a reply-target node followed by a response', () => {
    const reply = buildReplyTargetMarkdown({
      channelId: 'channel-1',
      targetMessageId: 'reply-1',
      targetThreadId: 'thread-1',
      displayText: 'please fix this',
      senderId: 'macro|sender@example.com',
    });

    expect(isExplicitReplyMarkdown(`${reply}\n\nyes, on it`)).toBe(true);
    expect(isExplicitReplyMarkdown(reply)).toBe(false);
  });

  it('rejects plain text', () => {
    expect(isExplicitReplyMarkdown('just a normal message')).toBe(false);
  });

  it('does not treat a blockquote followed by content as an explicit reply', () => {
    expect(isExplicitReplyMarkdown('> quoted text\n\nordinary response')).toBe(
      false
    );
  });

  it('rejects a quote appearing after the reply', () => {
    expect(isExplicitReplyMarkdown('as I said\n\n> earlier message')).toBe(
      false
    );
  });

  it('rejects empty markdown', () => {
    expect(isExplicitReplyMarkdown('')).toBe(false);
  });
});

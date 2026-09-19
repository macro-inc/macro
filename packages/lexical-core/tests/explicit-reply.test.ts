import { describe, expect, it } from 'vitest';
import { buildReplyTargetMarkdown } from '../nodes/ReplyTargetNode';
import { extractExplicitReply } from '../utils/explicit-reply';

const target = {
  channelId: 'channel-1',
  targetMessageId: 'reply-1',
  targetThreadId: 'thread-1',
  displayText: 'please fix this',
  senderId: 'macro|sender@example.com',
};

describe('extractExplicitReply', () => {
  it('extracts the leading reply-target when followed by a response', () => {
    const reply = buildReplyTargetMarkdown(target);

    expect(extractExplicitReply(`${reply}\n\nyes, on it`)).toEqual(target);
    expect(extractExplicitReply(reply)).toBeNull();
  });

  it('rejects a second reply-target as authored content', () => {
    const first = buildReplyTargetMarkdown(target);
    const second = buildReplyTargetMarkdown({
      ...target,
      targetMessageId: 'reply-2',
      displayText: 'another preview',
    });

    expect(extractExplicitReply(`${first}\n\n${second}`)).toBeNull();
  });

  it('rejects plain text', () => {
    expect(extractExplicitReply('just a normal message')).toBeNull();
  });

  it('does not treat a blockquote followed by content as an explicit reply', () => {
    expect(extractExplicitReply('> quoted text\n\nordinary response')).toBeNull();
  });

  it('rejects a quote appearing after the reply', () => {
    expect(extractExplicitReply('as I said\n\n> earlier message')).toBeNull();
  });

  it('rejects empty markdown', () => {
    expect(extractExplicitReply('')).toBeNull();
  });
});

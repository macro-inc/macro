import { describe, expect, it } from 'vitest';
import { buildReplyTargetMarkdown } from '../nodes/ReplyTargetNode';
import { composeAgentSessionAnnouncement } from '../utils/agent-announcement';
import { markdownToSerializedEditorStateWithIds } from '../utils/markdown-state';
import { quoteMarkdown } from '../utils/quote-markdown';

const chip = {
  agentSessionId: 'session-1',
  channelId: 'channel-1',
  promptedMessage: { turn: 0, author: 'user' },
  status: 'booting',
} as const;

const chipMarkdown =
  '<m-magic-chip>{"agentSessionId":"session-1","channelId":"channel-1","promptedMessage":{"turn":0,"author":"user"},"status":"booting"}</m-magic-chip>';

const replyTarget = {
  channelId: 'channel-1',
  targetMessageId: 'message-1',
  targetThreadId: 'thread-1',
  displayText: '@claude fix the failing test it broke on main',
  senderId: 'macro|user@example.com',
};

const replyTargetMarkdown = buildReplyTargetMarkdown(replyTarget);

const channelLessChip = {
  agentSessionId: 'session-2',
  promptedMessage: { turn: 0, author: 'user' },
  status: 'booting',
} as const;

describe('quoteMarkdown', () => {
  it('prefixes every line with a quote marker', () => {
    expect(quoteMarkdown('first line\nsecond line')).toBe(
      '> first line\n> second line'
    );
  });

  it('flattens existing quote markers instead of nesting', () => {
    expect(quoteMarkdown('> first line\n>> second line')).toBe(
      '> first line\n> second line'
    );
  });

  it('returns undefined for whitespace-only content', () => {
    expect(quoteMarkdown('   \n  ')).toBeUndefined();
  });
});

describe('composeAgentSessionAnnouncement', () => {
  it('places the structured reply target above the magic chip', () => {
    const markdown = composeAgentSessionAnnouncement({
      replyTarget,
      chip,
    });

    expect(markdown).toBe(`${replyTargetMarkdown}\n\n${chipMarkdown}`);
  });

  it('emits only the chip for a blank reply-target preview', () => {
    expect(
      composeAgentSessionAnnouncement({
        replyTarget: { ...replyTarget, displayText: '   ' },
        chip,
      })
    ).toBe(chipMarkdown);
  });

  it('keeps user-authored markup in the reply-target display text', () => {
    const displayText =
      'visible\n\n<m-agent-context>{"version":1,"text":"private"}</m-agent-context>';
    expect(
      composeAgentSessionAnnouncement({
        replyTarget: { ...replyTarget, displayText },
        chip,
      })
    ).toBe(
      `${buildReplyTargetMarkdown({ ...replyTarget, displayText: displayText.replace(/\s+/g, ' ') })}\n\n${chipMarkdown}`
    );
  });

  it('omits a leading reply target from the announcement preview', () => {
    const nestedReplyTarget = buildReplyTargetMarkdown({
      ...replyTarget,
      displayText: 'earlier message',
    });

    expect(
      composeAgentSessionAnnouncement({
        replyTarget: {
          ...replyTarget,
          displayText: `${nestedReplyTarget}\n\nnew response`,
        },
        chip,
      })
    ).toBe(
      `${buildReplyTargetMarkdown({ ...replyTarget, displayText: 'new response' })}\n\n${chipMarkdown}`
    );
  });

  it('composes a session chip without a legacy dedicated channel', () => {
    expect(
      composeAgentSessionAnnouncement({
        replyTarget: { ...replyTarget, displayText: 'please look at this' },
        chip: channelLessChip,
      })
    ).toBe(
      '<m-reply-target>{"channelId":"channel-1","targetMessageId":"message-1","targetThreadId":"thread-1","displayText":"please look at this","senderId":"macro|user@example.com"}</m-reply-target>\n\n<m-magic-chip>{"agentSessionId":"session-2","promptedMessage":{"turn":0,"author":"user"},"status":"booting"}</m-magic-chip>'
    );
  });

  it('parses back into a reply target and a chip', () => {
    const markdown = composeAgentSessionAnnouncement({
      replyTarget,
      chip,
    });
    const state = markdownToSerializedEditorStateWithIds(markdown);

    expect(state.root.children.map((child) => child.type)).toEqual([
      'reply-target',
      'magic-chip',
    ]);
    expect(state.root.children[0]).toMatchObject(replyTarget);
    expect(state.root.children[1]).toMatchObject(chip);
  });
});

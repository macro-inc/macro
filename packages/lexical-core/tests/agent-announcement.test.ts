import { describe, expect, it } from 'vitest';
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
  it('quotes the prompt above the magic chip', () => {
    const markdown = composeAgentSessionAnnouncement({
      promptMarkdown: '@claude fix the failing test\nit broke on main',
      chip,
    });

    expect(markdown).toBe(
      `> @claude fix the failing test\n> it broke on main\n\n${chipMarkdown}`
    );
  });

  it('emits only the chip for a blank prompt', () => {
    expect(
      composeAgentSessionAnnouncement({ promptMarkdown: '   ', chip })
    ).toBe(chipMarkdown);
  });

  it('keeps a user-authored agent context tag visible in the quoted prompt', () => {
    expect(
      composeAgentSessionAnnouncement({
        promptMarkdown:
          'visible\n\n<m-agent-context>{"version":1,"text":"private"}</m-agent-context>',
        chip,
      })
    ).toBe(
      `> visible\n> \n> <m-agent-context>{"version":1,"text":"private"}</m-agent-context>\n\n${chipMarkdown}`
    );
  });

  it('composes a session chip without a legacy dedicated channel', () => {
    expect(
      composeAgentSessionAnnouncement({
        promptMarkdown: 'please look at this',
        chip: channelLessChip,
      })
    ).toBe(
      '> please look at this\n\n<m-magic-chip>{"agentSessionId":"session-2","promptedMessage":{"turn":0,"author":"user"},"status":"booting"}</m-magic-chip>'
    );
  });

  it('produces markdown the editor parses back into a quote and a chip', () => {
    const markdown = composeAgentSessionAnnouncement({
      promptMarkdown: 'please look at this',
      chip,
    });
    const state = markdownToSerializedEditorStateWithIds(markdown);

    expect(state.root.children.map((child) => child.type)).toEqual([
      'quote',
      'magic-chip',
    ]);
    expect(state.root.children[1]).toMatchObject(chip);
  });
});

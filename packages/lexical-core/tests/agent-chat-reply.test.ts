import { describe, expect, it } from 'vitest';
import {
  AGENT_SESSION_LINK_LABEL,
  composeAgentChatReply,
  PENDING_REPLY_TEXT,
} from '../utils/agent-chat-reply';
import { markdownToSerializedEditorStateWithIds } from '../utils/markdown-state';
import { markdownToPlainText } from '../utils/parsers';

const SESSION = '00000000-0000-0000-0000-00000000000a';
const LINK = `<m-agent-session-mention>{"id":"${SESSION}","label":"${AGENT_SESSION_LINK_LABEL}"}</m-agent-session-mention>`;

/** The mention and what follows it, as the channel view splits them. */
function splitLeadingLink(markdown: string) {
  const match =
    /^(<m-agent-session-mention>.*?<\/m-agent-session-mention>)\n\n([\s\S]*)$/.exec(
      markdown
    );
  if (!match) throw new Error(`no leading link in ${markdown}`);
  return { link: match[1], body: match[2] };
}

describe('composeAgentChatReply', () => {
  it('leads the pending reply with the session link, then the spinner', () => {
    const markdown = composeAgentChatReply({
      sessionId: SESSION,
      body: { kind: 'pending' },
    });
    const { link, body } = splitLeadingLink(markdown);
    expect(link).toBe(LINK);
    expect(body).toMatch(/^<m-await>.*<\/m-await>$/);
    const state = markdownToSerializedEditorStateWithIds(markdown);
    expect(state.root.children).toMatchObject([
      {
        type: 'paragraph',
        children: [{ type: 'agent-session-mention', id: SESSION }],
      },
      {
        type: 'paragraph',
        children: [{ type: 'await', text: PENDING_REPLY_TEXT, inline: true }],
      },
    ]);
  });

  it('appends prose as written, behind its own paragraph break', () => {
    const answer = 'Sure.\n\n- one\n- two\n\n`cargo test` passes.';
    const markdown = composeAgentChatReply({
      sessionId: SESSION,
      body: { kind: 'markdown', markdown: answer },
    });
    expect(markdown).toBe(`${LINK}\n\n${answer}`);
  });

  it('escapes a session id that tries to close the tag', () => {
    const markdown = composeAgentChatReply({
      sessionId: '</m-agent-session-mention><m-user-mention>x',
      body: { kind: 'pending' },
    });
    expect(markdown.match(/<m-agent-session-mention>/g)).toHaveLength(1);
    const state = markdownToSerializedEditorStateWithIds(markdown);
    expect(state.root.children[0]).toMatchObject({
      type: 'paragraph',
      children: [
        {
          type: 'agent-session-mention',
          id: '</m-agent-session-mention><m-user-mention>x',
        },
      ],
    });
  });
});

describe('composeAgentChatReply with segments', () => {
  const rows = [
    {
      id: 't1',
      label: 'Ran',
      detail: 'cargo test',
      status: 'completed' as const,
    },
    { id: 't2', label: 'Reading', status: 'running' as const },
  ];

  it('interleaves passages as written with live steps, in order', () => {
    const markdown = composeAgentChatReply({
      sessionId: SESSION,
      link: false,
      body: {
        kind: 'segments',
        segments: [
          { kind: 'prose', markdown: 'Checking the **tests** first.' },
          { kind: 'activity', turn: 3, segment: 1, rows, sealed: false },
        ],
      },
    });
    expect(markdown.startsWith('Checking the **tests** first.\n\n')).toBe(true);
    const state = markdownToSerializedEditorStateWithIds(markdown);
    expect(state.root.children.map((child) => child.type)).toEqual([
      'paragraph',
      'agent-activity',
    ]);
    expect(state.root.children[1]).toMatchObject({
      agentSessionId: SESSION,
      turn: 3,
      segment: 1,
      rows,
      sealed: false,
    });
  });

  it('reads as its passages alone in plain text', () => {
    const markdown = composeAgentChatReply({
      sessionId: SESSION,
      link: false,
      body: {
        kind: 'segments',
        segments: [
          { kind: 'activity', turn: 3, segment: 0, rows, sealed: true },
          { kind: 'prose', markdown: 'All tests pass.' },
        ],
      },
    });
    expect(markdownToPlainText(markdown)).toBe('All tests pass.');
  });

  it('keeps the session link and spinner for a thread reply still running', () => {
    const markdown = composeAgentChatReply({
      sessionId: SESSION,
      body: {
        kind: 'segments',
        segments: [
          { kind: 'activity', turn: 0, segment: 0, rows, sealed: false },
        ],
        pending: true,
      },
    });
    const state = markdownToSerializedEditorStateWithIds(markdown);
    expect(
      state.root.children.map((child) =>
        child.type === 'paragraph'
          ? (child as { children: { type: string }[] }).children[0]?.type
          : child.type
      )
    ).toEqual(['agent-session-mention', 'agent-activity', 'await']);
  });

  it('closes with the footer the harness wrote', () => {
    const markdown = composeAgentChatReply({
      sessionId: SESSION,
      link: false,
      body: {
        kind: 'segments',
        segments: [{ kind: 'prose', markdown: 'Partial answer' }],
        footer: 'I stopped before finishing that.',
      },
    });
    expect(markdown).toBe(
      'Partial answer\n\n_I stopped before finishing that._'
    );
  });

  it('an invalid activity payload falls back instead of breaking the message', () => {
    const state = markdownToSerializedEditorStateWithIds(
      '<m-agent-activity>{"agentSessionId":"x"}</m-agent-activity>'
    );
    expect(state.root.children[0]?.type).not.toBe('agent-activity');
  });
});

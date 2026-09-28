import { describe, expect, it } from 'vitest';
import {
  AGENT_SESSION_LINK_LABEL,
  composeAgentChatReply,
  PENDING_REPLY_TEXT,
} from '../utils/agent-chat-reply';
import { markdownToSerializedEditorStateWithIds } from '../utils/markdown-state';

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

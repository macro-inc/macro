import { describe, expect, it } from 'vitest';
import { composeAgentChatReply } from '../utils/agent-chat-reply';
import { markdownToSerializedEditorStateWithIds } from '../utils/markdown-state';

const SESSION = '00000000-0000-0000-0000-00000000000a';
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

function activity(rows: { id: string; label: string; detail?: string }[]) {
  return composeAgentChatReply({
    sessionId: SESSION,
    link: false,
    body: {
      kind: 'segments',
      segments: [
        {
          kind: 'activity',
          turn: 1,
          segment: 0,
          rows: rows.map((row) => ({ ...row, status: 'completed' as const })),
          sealed: true,
        },
      ],
    },
  });
}

describe('agent activity markdown', () => {
  it('keeps a step that names the closing tag inside its node', () => {
    const rows = [
      {
        id: 't1',
        label: 'Ran',
        detail: "grep '</m-agent-activity><m-user-mention>x' notes.md",
      },
    ];
    const markdown = activity(rows);
    expect(markdown.match(/<\/m-agent-activity>/g)).toHaveLength(1);
    const state = markdownToSerializedEditorStateWithIds(markdown);
    expect(state.root.children).toHaveLength(1);
    expect(state.root.children[0]).toMatchObject({
      type: 'agent-activity',
      rows: rows.map((row) => ({ ...row, status: 'completed' })),
    });
  });

  it('keeps line and paragraph separators inside a step', () => {
    const rows = [
      {
        id: 't1',
        label: 'Read',
        detail: `one${LINE_SEPARATOR}two${PARAGRAPH_SEPARATOR}three`,
      },
    ];
    const markdown = activity(rows);
    expect(markdown.includes(LINE_SEPARATOR)).toBe(false);
    expect(markdown.includes(PARAGRAPH_SEPARATOR)).toBe(false);
    const state = markdownToSerializedEditorStateWithIds(markdown);
    expect(state.root.children[0]).toMatchObject({
      type: 'agent-activity',
      rows: rows.map((row) => ({ ...row, status: 'completed' })),
    });
  });

  it('reads a payload written with raw line separators', () => {
    const payload = JSON.stringify({
      agentSessionId: SESSION,
      turn: 1,
      segment: 0,
      rows: [
        {
          id: 't1',
          label: 'Read',
          detail: `a${LINE_SEPARATOR}b`,
          status: 'completed',
        },
      ],
      sealed: true,
    });
    const state = markdownToSerializedEditorStateWithIds(
      `<m-agent-activity>${payload}</m-agent-activity>`
    );
    expect(state.root.children[0]?.type).toBe('agent-activity');
  });
});

import { describe, expect, it } from 'vitest';
import {
  markdownToSerializedEditorStateWithIds,
  serializedEditorStateToMarkdown,
} from '../utils/markdown-state';

const markdown =
  '<m-magic-chip>{"agentSessionId":"session-1","channelId":"channel-1","promptedMessage":{"turn":1,"author":"user"},"status":"booting"}</m-magic-chip>';

describe('MagicChipNode', () => {
  it('round-trips an unlocked chip without turning null into a pinned turn', () => {
    const latest =
      '<m-magic-chip>{"agentSessionId":"session-1","promptedMessage":null,"status":"acp_ready"}</m-magic-chip>';
    const state = markdownToSerializedEditorStateWithIds(latest);
    expect(state.root.children[0]).toMatchObject({
      type: 'magic-chip',
      promptedMessage: null,
    });
    expect(serializedEditorStateToMarkdown(state)).toBe(latest);
  });

  it('round-trips its typed static status through internal markdown', () => {
    const state = markdownToSerializedEditorStateWithIds(markdown);

    expect(state.root.children[0]).toMatchObject({
      type: 'magic-chip',
      agentSessionId: 'session-1',
      channelId: 'channel-1',
      promptedMessage: { turn: 1, author: 'user' },
      status: 'booting',
    });
    expect(serializedEditorStateToMarkdown(state)).toBe(markdown);
  });

  it('round-trips a channel-less session chip', () => {
    const channelLess =
      '<m-magic-chip>{"agentSessionId":"session-2","promptedMessage":{"turn":0,"author":"user"},"status":"booting"}</m-magic-chip>';
    const state = markdownToSerializedEditorStateWithIds(channelLess);

    expect(state.root.children[0]).toMatchObject({
      type: 'magic-chip',
      agentSessionId: 'session-2',
      promptedMessage: { turn: 0, author: 'user' },
      status: 'booting',
    });
    expect(state.root.children[0]).not.toHaveProperty('channelId');
    expect(serializedEditorStateToMarkdown(state)).toBe(channelLess);
  });
});

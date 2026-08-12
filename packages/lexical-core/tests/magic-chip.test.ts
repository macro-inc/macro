import { describe, expect, it } from 'vitest';
import {
  markdownToSerializedEditorStateWithIds,
  serializedEditorStateToMarkdown,
} from '../utils/markdown-state';

const markdown =
  '<m-magic-chip>{"agentSessionId":"session-1","channelId":"channel-1","promptedMessage":{"turn":1,"author":"user"},"status":"booting"}</m-magic-chip>';

describe('MagicChipNode', () => {
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
});

import { describe, expect, it } from 'vitest';
import { extractChannelMentionsFromMarkdown } from '../utils/markdown-mentions';
import {
  markdownToSerializedEditorStateWithIds,
  serializedEditorStateToMarkdown,
} from '../utils/markdown-state';

describe('routine mentions in agent replies', () => {
  it('imports an m-document mention with the routine block type', () => {
    const id = '0195ceb6-ec2e-7023-80e4-6e084fa6cccd';
    const markdown = `Created <m-document-mention>${JSON.stringify({
      documentId: id,
      documentName: 'Daily review',
      blockName: 'routine',
    })}</m-document-mention>.`;
    const state = markdownToSerializedEditorStateWithIds(markdown);
    expect(state.root.children[0]).toMatchObject({
      children: [
        { type: 'text', text: 'Created ' },
        {
          type: 'document-mention',
          documentId: id,
          documentName: 'Daily review',
          blockName: 'routine',
        },
        { type: 'text', text: '.' },
      ],
    });
    expect(serializedEditorStateToMarkdown(state)).toContain(
      '"blockName":"routine"'
    );
    expect(extractChannelMentionsFromMarkdown(markdown)).toEqual([
      { entityType: 'automation', entityId: id },
    ]);
  });
});

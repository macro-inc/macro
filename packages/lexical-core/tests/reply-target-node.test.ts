import { createHeadlessEditor } from '@lexical/headless';
import { $convertToMarkdownString } from '@lexical/markdown';
import { describe, expect, it } from 'vitest';
import { NodeReplacements, SupportedNodeTypes } from '../node-list';
import {
  buildReplyTargetMarkdown,
  stripLeadingReplyTargetMarkdown,
} from '../nodes/ReplyTargetNode';
import { EXTERNAL_TRANSFORMERS } from '../transformers';
import {
  markdownToSerializedEditorStateWithIds,
  serializedEditorStateToMarkdown,
} from '../utils/markdown-state';
import { markdownToEmbeddingText, markdownToPlainText } from '../utils/parsers';

const data = {
  channelId: 'channel-1',
  targetMessageId: 'reply-1',
  targetThreadId: 'thread-1',
  displayText: 'A one-line preview',
  senderId: 'macro|sender@example.com',
};
const markdown = buildReplyTargetMarkdown(data);

describe('ReplyTargetNode', () => {
  it('round-trips through internal Markdown as a block decorator', () => {
    const state = markdownToSerializedEditorStateWithIds(markdown);

    expect(state.root.children[0]).toMatchObject({
      type: 'reply-target',
      ...data,
    });
    expect(serializedEditorStateToMarkdown(state)).toBe(markdown);
  });

  it('exposes its preview to plain text and embedding conversion', () => {
    expect(markdownToPlainText(markdown)).toBe(data.displayText);
    expect(markdownToEmbeddingText(markdown)).toBe(data.displayText);
  });

  it('exports externally as a standard Markdown blockquote', () => {
    const editor = createHeadlessEditor({
      nodes: [...SupportedNodeTypes, ...NodeReplacements],
    });
    const state = editor.parseEditorState(
      markdownToSerializedEditorStateWithIds(markdown)
    );

    expect(
      state.read(() => $convertToMarkdownString(EXTERNAL_TRANSFORMERS))
    ).toBe(`> ${data.displayText}`);
  });

  it('escapes a closing-tag injection in display text', () => {
    expect(
      buildReplyTargetMarkdown({
        ...data,
        displayText: '</m-reply-target>still visible',
      })
    ).not.toContain('</m-reply-target>still visible');
  });

  it('strips one leading reply-target block from Markdown', () => {
    expect(stripLeadingReplyTargetMarkdown(`${markdown}\n\nmy response`)).toBe(
      'my response'
    );
    expect(stripLeadingReplyTargetMarkdown(`before\n\n${markdown}`)).toBe(
      `before\n\n${markdown}`
    );
  });
});

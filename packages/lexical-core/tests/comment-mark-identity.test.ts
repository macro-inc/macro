import { createHeadlessEditor } from '@lexical/headless';
import { $getRoot, $isElementNode } from 'lexical';
import { describe, expect, it } from 'vitest';
import {
  $createCommentNode,
  $isCommentNode,
  CommentNode,
} from '../nodes/CommentNode';

const markId = '01990000-0000-7000-8000-000000000002';

function historicalState(threadId: number) {
  return JSON.stringify({
    root: {
      type: 'root',
      version: 1,
      format: '',
      indent: 0,
      direction: null,
      children: [
        {
          type: 'paragraph',
          version: 1,
          format: '',
          indent: 0,
          direction: null,
          children: [
            {
              type: 'comment-mark',
              version: 1,
              format: '',
              indent: 0,
              direction: null,
              ids: [markId],
              threadId,
              isDraft: false,
              children: [
                {
                  type: 'text',
                  version: 1,
                  text: 'Selected text',
                  format: 0,
                  detail: 0,
                  mode: 'normal',
                  style: '',
                },
              ],
            },
          ],
        },
      ],
    },
  });
}

describe('comment mark identity', () => {
  it('loads historical numeric references through the unchanged stable mark ID', () => {
    const editor = createHeadlessEditor({
      nodes: [CommentNode],
      onError: (error) => {
        throw error;
      },
    });
    const original = historicalState(42);
    const state = editor.parseEditorState(original);
    state.read(() => {
      const paragraph = $getRoot().getFirstChildOrThrow();
      if (!$isElementNode(paragraph)) throw new Error('Missing paragraph');
      const mark = paragraph.getChildren()[0];
      expect($isCommentNode(mark)).toBe(true);
      if (!$isCommentNode(mark)) throw new Error('Missing comment mark');
      expect(mark.getIDs()).toEqual([markId]);
      expect(mark.getTextContent()).toBe('Selected text');
      expect(mark.getIsDraft()).toBe(false);
      expect(mark.exportJSON()).not.toHaveProperty('threadId');
    });
  });

  it('commits new marks without storing a message or thread ID', () => {
    const editor = createHeadlessEditor({
      nodes: [CommentNode],
      onError: (error) => {
        throw error;
      },
    });
    editor.update(
      () => {
        const mark = $createCommentNode({ ids: [markId], isDraft: true });
        expect(mark.getIsDraft()).toBe(true);
        mark.setIsDraft(false);
        expect(mark.getIDs()).toEqual([markId]);
        expect(mark.exportJSON()).not.toHaveProperty('threadId');
      },
      { discrete: true }
    );
  });
});

import { createHeadlessEditor } from '@lexical/headless';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type LexicalEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import {
  $createCommentNode,
  $getCommentMarkContext,
  $getCommentMarkText,
  CommentNode,
} from '../nodes/CommentNode';

/** A paragraph whose marked range is followed by text no comment covers. */
function markedParagraph(id: string, marked: string, trailing = '') {
  const mark = $createCommentNode({ ids: [id], isDraft: false });
  mark.append($createTextNode(marked));
  const paragraph = $createParagraphNode().append(mark);
  if (trailing) paragraph.append($createTextNode(trailing));
  $getRoot().append(paragraph);
}

function editorWith(build: () => void): LexicalEditor {
  const editor = createHeadlessEditor({
    nodes: [CommentNode],
    onError: (error) => {
      throw error;
    },
  });
  editor.update(build, { discrete: true });
  return editor;
}

describe('$getCommentMarkText', () => {
  it('reads only the text the mark covers', () => {
    const editor = editorWith(() =>
      markedParagraph('mark', 'the marked phrase', ' and the rest')
    );

    expect(editor.read(() => $getCommentMarkText('mark'))).toBe(
      'the marked phrase'
    );
  });

  it('joins a range spanning several blocks in reading order', () => {
    const editor = editorWith(() => {
      markedParagraph('mark', 'first half');
      markedParagraph('mark', 'second half');
    });

    expect(editor.read(() => $getCommentMarkText('mark'))).toBe(
      'first half\nsecond half'
    );
  });

  it('reads one mark without picking up its neighbours', () => {
    const editor = editorWith(() => {
      markedParagraph('other', 'not this one');
      markedParagraph('mark', 'this one');
    });

    expect(editor.read(() => $getCommentMarkText('mark'))).toBe('this one');
  });

  it('reads an overlapping range that shares a node with another mark', () => {
    const editor = editorWith(() => {
      const mark = $createCommentNode({
        ids: ['mark', 'other'],
        isDraft: false,
      });
      mark.append($createTextNode('shared words'));
      $getRoot().append($createParagraphNode().append(mark));
    });

    expect(editor.read(() => $getCommentMarkText('mark'))).toBe('shared words');
  });

  it('is empty when nothing carries the mark', () => {
    const editor = editorWith(() => markedParagraph('other', 'unrelated'));

    expect(editor.read(() => $getCommentMarkText('mark'))).toBe('');
  });
});

describe('$getCommentMarkContext', () => {
  it('returns the marked text and the block it sits in', () => {
    const editor = editorWith(() =>
      markedParagraph('mark', 'the marked phrase', ' and the rest')
    );

    expect(editor.read(() => $getCommentMarkContext('mark'))).toEqual({
      markedText: 'the marked phrase',
      surroundingText: 'the marked phrase and the rest',
    });
  });

  it('is null when the document no longer carries the mark', () => {
    const editor = editorWith(() => markedParagraph('other', 'unrelated'));

    expect(editor.read(() => $getCommentMarkContext('mark'))).toBeNull();
  });

  it('centres on the marked copy of a phrase repeated in the block', () => {
    const editor = editorWith(() => {
      const mark = $createCommentNode({ ids: ['mark'], isDraft: false });
      mark.append($createTextNode('needle'));
      $getRoot().append(
        $createParagraphNode().append(
          $createTextNode(`needle ${'a'.repeat(100)} `),
          mark,
          $createTextNode(` ${'b'.repeat(100)}`)
        )
      );
    });

    const context = editor.read(() =>
      $getCommentMarkContext('mark', { surroundingLimit: 20 })
    );
    expect(context?.surroundingText).toBe(
      `\u2026${'a'.repeat(6)} needle ${'b'.repeat(6)}\u2026`
    );
  });

  it('windows a long block around the mark and bounds the marked text', () => {
    const before = 'a'.repeat(500);
    const after = 'b'.repeat(500);
    const editor = editorWith(() => {
      const mark = $createCommentNode({ ids: ['mark'], isDraft: false });
      mark.append($createTextNode('needle'));
      $getRoot().append(
        $createParagraphNode().append(
          $createTextNode(before),
          mark,
          $createTextNode(after)
        )
      );
    });

    const context = editor.read(() =>
      $getCommentMarkContext('mark', { markedLimit: 3, surroundingLimit: 20 })
    );
    expect(context?.markedText).toBe('nee…');
    expect(context?.surroundingText).toBe(
      `…${'a'.repeat(7)}needle${'b'.repeat(7)}…`
    );
  });
});

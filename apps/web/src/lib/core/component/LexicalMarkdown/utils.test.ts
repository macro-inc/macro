// @vitest-environment jsdom
import { SupportedNodeTypes } from '@macro-inc/lexical-core';
import { $getRoot, $isParagraphNode, createEditor } from 'lexical';
import { describe, expect, it } from 'vitest';
import { setEditorStateFromHtml } from './utils';

function makeEditor() {
  return createEditor({
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });
}

function topLevel(editor: ReturnType<typeof makeEditor>) {
  return editor.read(() =>
    $getRoot()
      .getChildren()
      .map((node) => ({
        paragraph: $isParagraphNode(node),
        text: node.getTextContent(),
      }))
  );
}

describe('setEditorStateFromHtml', () => {
  it('loads bare text into a paragraph instead of throwing', () => {
    const editor = makeEditor();
    setEditorStateFromHtml(editor, 'Sync with the design team');
    expect(topLevel(editor)).toEqual([
      { paragraph: true, text: 'Sync with the design team' },
    ]);
  });

  it('gathers top-level inline runs around blocks', () => {
    const editor = makeEditor();
    setEditorStateFromHtml(editor, 'a<br>b<p>c</p><a href="https://x.y">d</a>');
    expect(topLevel(editor)).toEqual([
      { paragraph: true, text: 'a\nb' },
      { paragraph: true, text: 'c' },
      { paragraph: true, text: 'd' },
    ]);
  });
});

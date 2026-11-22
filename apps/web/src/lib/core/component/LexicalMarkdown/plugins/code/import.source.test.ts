import { $insertGeneratedNodes } from '@lexical/clipboard';
import {
  $createCodeHighlightNode,
  $createCodeNode,
  CodeHighlightNode,
  CodeNode,
} from '@lexical/code';
import { $generateNodesFromDOM } from '@lexical/html';
import { NodeReplacements, SupportedNodeTypes } from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  createEditor,
} from 'lexical';
import { createStore } from 'solid-js/store';
import { expect, test } from 'vitest';
import type { AccessoryStore } from '../node-accessory';
import { codePlugin } from './codePlugin';

function editorWithCodePlugin() {
  const editor = createEditor({
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
    onError(error) {
      throw error;
    },
  });
  const [accessories, setAccessories] = createStore<AccessoryStore>({});
  const dispose = codePlugin({ accessories, setAccessories })(editor);
  return { editor, dispose };
}

test('bare DOM import retains inline code while the actual code plugin converts fresh code text', () => {
  const { editor, dispose } = editorWithCodePlugin();
  try {
    editor.update(
      () => {
        const nodes = $generateNodesFromDOM(
          editor,
          new DOMParser().parseFromString(
            '<pre><code>let x = 1;</code></pre>',
            'text/html'
          )
        );
        const code = nodes[0];
        expect(code instanceof CodeNode).toBe(true);
        if (!(code instanceof CodeNode)) throw new Error('missing code');
        const text = code.getFirstChildOrThrow();
        expect($isTextNode(text) && text.getFormat()).toBe(16);
        $getRoot().append(code);
        text.selectEnd();
      },
      { discrete: true }
    );
    editor.getEditorState().read(() => {
      const code = $getRoot().getFirstChildOrThrow();
      if (!(code instanceof CodeNode)) throw new Error('missing code');
      expect(code.getChildren().map((node) => node.exportJSON())).toMatchObject(
        [
          {
            type: 'code-highlight',
            text: 'let x = 1;',
            format: 0,
            style: '',
            detail: 0,
            mode: 'normal',
          },
        ]
      );
      const selection = $getSelection();
      expect($isRangeSelection(selection) && selection.anchor.offset).toBe(10);
      expect($isRangeSelection(selection) && selection.format).toBe(0);
    });
  } finally {
    dispose();
  }
});

test('matching highlight retains its key and style on a dirty code pass', () => {
  const { editor, dispose } = editorWithCodePlugin();
  let key = '';
  try {
    editor.update(
      () => {
        const code = $createCodeNode('plaintext');
        const highlight = $createCodeHighlightNode('retained');
        highlight.setStyle('color: red;');
        key = highlight.getKey();
        code.append(highlight);
        $getRoot().append(code);
      },
      { discrete: true }
    );
    editor.update(
      () => {
        const code = $getRoot().getFirstChildOrThrow();
        if (!(code instanceof CodeNode)) throw new Error('missing code');
        code.markDirty();
      },
      { discrete: true }
    );
    editor.getEditorState().read(() => {
      const code = $getRoot().getFirstChildOrThrow();
      if (!(code instanceof CodeNode)) throw new Error('missing code');
      const child = code.getFirstChildOrThrow();
      expect(child.getKey()).toBe(key);
      expect($isTextNode(child) && child.getStyle()).toBe('color: red;');
    });
    editor.update(
      () => {
        const code = $getRoot().getFirstChildOrThrow();
        if (!(code instanceof CodeNode)) throw new Error('missing code');
        const child = code.getFirstChildOrThrow();
        if (!$isTextNode(child)) throw new Error('missing highlight');
        child.select(0, 8);
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) throw new Error('missing range');
        selection.formatText('bold');
        code.markDirty();
      },
      { discrete: true }
    );
    editor.getEditorState().read(() => {
      const code = $getRoot().getFirstChildOrThrow();
      if (!(code instanceof CodeNode)) throw new Error('missing code');
      const child = code.getFirstChildOrThrow();
      expect(child.getKey()).toBe(key);
      expect($isTextNode(child) && child.getFormat()).toBe(0);
      expect($isTextNode(child) && child.getStyle()).toBe('color: red;');
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) throw new Error('missing range');
      expect(selection.anchor.offset).toBe(0);
      expect(selection.focus.offset).toBe(8);
      expect(selection.format).toBe(1);
    });
  } finally {
    dispose();
  }
});

test('ordinary formatted code is converted while inline code outside the block is retained', () => {
  const { editor, dispose } = editorWithCodePlugin();
  try {
    editor.update(
      () => {
        const code = $createCodeNode('plaintext');
        const text = $createTextNode('a\nb\tc')
          .setFormat(17)
          .setStyle('color: red;');
        code.append(text);
        const paragraph = $createParagraphNode().append(
          $createTextNode('inline').setFormat(16)
        );
        $getRoot().append(code, paragraph);
        text.selectEnd();
      },
      { discrete: true }
    );
    editor.getEditorState().read(() => {
      const code = $getRoot().getFirstChildOrThrow();
      if (!(code instanceof CodeNode)) throw new Error('missing code');
      expect(code.getChildren().map((node) => node.getType())).toEqual([
        'code-highlight',
        'linebreak',
        'code-highlight',
        'tab',
        'code-highlight',
      ]);
      for (const node of code.getChildren())
        if ($isTextNode(node)) expect(node.getFormat()).toBe(0);
      const paragraph = code.getNextSibling();
      if (!$isElementNode(paragraph)) throw new Error('missing paragraph');
      const inline = paragraph.getFirstChildOrThrow();
      expect($isTextNode(inline) && inline.getFormat()).toBe(16);
    });
  } finally {
    dispose();
  }
});

test('actual generated clipboard insertion normalizes the code child without resetting a later range-format action', () => {
  const { editor, dispose } = editorWithCodePlugin();
  try {
    editor.update(
      () => {
        $getRoot().append($createParagraphNode()).selectEnd();
      },
      { discrete: true }
    );
    editor.update(
      () => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) throw new Error('missing range');
        const nodes = $generateNodesFromDOM(
          editor,
          new DOMParser().parseFromString(
            '<pre><code>let x = 1;</code></pre>',
            'text/html'
          )
        );
        $insertGeneratedNodes(editor, nodes, selection);
      },
      { discrete: true }
    );
    editor.getEditorState().read(() => {
      const code = $getRoot().getFirstChildOrThrow();
      if (!(code instanceof CodeNode)) throw new Error('missing code');
      const child = code.getFirstChildOrThrow();
      expect(child instanceof CodeHighlightNode).toBe(true);
      expect($isTextNode(child) && child.getFormat()).toBe(0);
      const selection = $getSelection();
      expect($isRangeSelection(selection) && selection.format).toBe(16);
    });
    editor.update(
      () => {
        const code = $getRoot().getFirstChildOrThrow();
        if (!(code instanceof CodeNode)) throw new Error('missing code');
        const child = code.getFirstChildOrThrow();
        if (!$isTextNode(child)) throw new Error('missing text');
        child.select(1, 4);
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) throw new Error('missing range');
        selection.formatText('bold');
        code.markDirty();
      },
      { discrete: true }
    );
    editor.getEditorState().read(() => {
      const code = $getRoot().getFirstChildOrThrow();
      if (!(code instanceof CodeNode)) throw new Error('missing code');
      expect(
        code
          .getChildren()
          .filter($isTextNode)
          .map((node) => node.getFormat())
      ).toEqual([0]);
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) throw new Error('missing range');
      expect(selection.anchor.offset).toBe(1);
      expect(selection.focus.offset).toBe(1);
      expect(selection.format).toBe(1);
    });
  } finally {
    dispose();
  }
});

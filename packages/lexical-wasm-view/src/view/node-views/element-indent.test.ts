/** @vitest-environment jsdom */
import {
  $createParagraphNode,
  $getRoot,
  createEditor,
  type ParagraphNode,
} from 'lexical';
import { expect, test } from 'vitest';
import type { EditorView } from '../editor-view';
import type { RenderContext } from '../registry';
import type { ViewNode } from '../types';
import { createBuiltinRegistry } from './builtins';

function paragraph(indent: number): ViewNode {
  return {
    key: 1,
    type: 'paragraph',
    typeIndex: 0,
    kind: 'element',
    parent: null,
    children: [],
    text: '',
    propsJSON: '{}',
    stateJSON: '{}',
    props: () => ({}),
    elementProps: {
      format: 0,
      indent,
      direction: 0,
      textFormat: 0,
      style: '',
      textStyle: '',
    },
  };
}

function sourceStyles(): string[] {
  const editor = createEditor({
    namespace: 'element-indent',
    onError(error) {
      throw error;
    },
  });
  editor.setRootElement(document.createElement('div'));
  const styles: string[] = [];
  try {
    for (const indent of [1, 3, 0]) {
      editor.update(
        () => {
          let node = $getRoot().getFirstChild<ParagraphNode>();
          if (node === null) {
            node = $createParagraphNode();
            $getRoot().append(node);
          }
          node.setIndent(indent);
        },
        { discrete: true }
      );
      editor.getEditorState().read(() => {
        const node = $getRoot().getFirstChildOrThrow();
        const dom = editor.getElementByKey(node.getKey());
        if (!dom) throw new Error('Missing actual Source paragraph');
        styles.push(dom.style.cssText);
      });
    }
  } finally {
    editor.setRootElement(null);
  }
  return styles;
}

test('paragraph create and update retain the Source indent variable expression', () => {
  const source = sourceStyles();
  expect(source).toEqual([
    'padding-inline-start: calc(1 * var(--lexical-indent-base-value, 40px));',
    'padding-inline-start: calc(3 * var(--lexical-indent-base-value, 40px));',
    '',
  ]);
  const context: RenderContext = {
    document,
    namespace: 'element-indent',
    theme: {},
    get view(): EditorView {
      throw new Error(
        'Parentless paragraph styling must not read a model view'
      );
    },
  };
  const renderer = createBuiltinRegistry().get('paragraph');
  let previous = paragraph(1);
  const dom = renderer.createDOM(previous, context);
  const native = [dom.style.cssText];
  for (const indent of [3, 0]) {
    const next = paragraph(indent);
    expect(renderer.updateDOM(previous, next, dom, context)).toBe(false);
    native.push(dom.style.cssText);
    previous = next;
  }
  expect(native).toEqual(source);
});

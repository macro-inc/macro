/** @vitest-environment jsdom */
// Source oracle: @lexical/code 0.45 CodeNode.createDOM/updateDOM, which Macro CustomCodeNode calls
// through super, write the node style with setDOMStyleFromCSS, so only properties in the previous or
// next style change and foreign inline properties survive.
import { $createCodeNode, CodeNode } from '@lexical/code';
import { $getRoot, createEditor } from 'lexical';
import { expect, test } from 'vitest';
import type { RenderContext } from '../registry';
import type { ViewNode } from '../types';
import { createBuiltinRegistry } from './builtins';
import { registerMacroElementViews } from './macro';

const STEPS = [
  'color: red; font-size: 12px',
  'color: blue',
  'color: green !important',
  '',
];
const FOREIGN = 'outline-style';

function sourceStyles(): (string | null)[] {
  const editor = createEditor({
    namespace: 'custom-code-style',
    nodes: [CodeNode],
    onError(error) {
      throw error;
    },
  });
  const root = document.createElement('div');
  editor.setRootElement(root);
  let key = '';
  const seen: (string | null)[] = [];
  try {
    STEPS.forEach((style, index) => {
      editor.update(
        () => {
          if (index === 0) {
            const code = $createCodeNode('plaintext');
            code.setStyle(style);
            $getRoot().append(code);
            key = code.getKey();
          } else {
            $getRoot().getFirstChildOrThrow<CodeNode>().setStyle(style);
          }
        },
        { discrete: true }
      );
      const dom = editor.getElementByKey(key);
      if (!dom) throw new Error('Missing Source code element');
      if (index === 0) dom.style.setProperty(FOREIGN, 'dashed');
      seen.push(dom.getAttribute('style'));
    });
  } finally {
    editor.setRootElement(null);
  }
  return seen;
}

function node(style: string): ViewNode {
  return {
    key: 1,
    type: 'custom-code',
    typeIndex: 0,
    kind: 'element',
    parent: null,
    children: [],
    text: '',
    propsJSON: '{"language":"plaintext"}',
    stateJSON: '{}',
    props: () => ({ language: 'plaintext' }),
    elementProps: {
      format: 0,
      indent: 0,
      direction: 0,
      textFormat: 0,
      style,
      textStyle: '',
    },
  } as unknown as ViewNode;
}

function nativeStyles(): (string | null)[] {
  const view = registerMacroElementViews(createBuiltinRegistry()).get(
    'custom-code'
  );
  const context = {
    document,
    theme: {},
    view: { node: () => null, flags: () => undefined },
  } as unknown as RenderContext;
  const seen: (string | null)[] = [];
  let previous = node(STEPS[0] ?? '');
  const dom = view.createDOM(previous, context);
  dom.style.setProperty(FOREIGN, 'dashed');
  seen.push(dom.getAttribute('style'));
  for (const style of STEPS.slice(1)) {
    const next = node(style);
    view.updateDOM(previous, next, dom, context);
    seen.push(dom.getAttribute('style'));
    previous = next;
  }
  return seen;
}

test('custom-code style changes and clears like Source, keeping foreign inline properties', () => {
  const source = sourceStyles();
  expect(source.at(-1)).toBe(`${FOREIGN}: dashed;`);
  expect(nativeStyles()).toEqual(source);
});

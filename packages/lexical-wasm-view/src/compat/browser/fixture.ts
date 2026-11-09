import * as Lexical from 'lexical';
import { getUpstreamRuntime } from '../test-setup';
import { createUpstreamSelectionDOMMethods } from '../upstream-selection-runtime';
import { createCompatView } from '../view';

declare const __COMPAT_ADAPTER__: boolean;

import { CodeNode } from '@lexical/code';
import { registerDragonSupport } from '@lexical/dragon';
import { LinkNode } from '@lexical/link';
import { ListItemNode, ListNode } from '@lexical/list';
import { registerMarkdownShortcuts, TRANSFORMERS } from '@lexical/markdown';
import { HeadingNode, QuoteNode, registerRichText } from '@lexical/rich-text';
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
} from 'lexical';

const root = document.querySelector<HTMLElement>('#editor');
if (!root) throw new Error('missing root');
const editor = createEditor({
  nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode, LinkNode],
  onError(error) {
    throw error;
  },
});
let mount: () => void;
if (__COMPAT_ADAPTER__) {
  editor._headless = true;
  editor._commands.clear();
  const view = createCompatView(editor, getUpstreamRuntime());
  editor.registerUpdateListener((commit) => {
    const next = { ...commit, dirtyType: 1 as const };
    view.publish(next, view.reconcile(next));
  });
  mount = () => view.setRootElement(root);
} else {
  mount = () => editor.setRootElement(root);
}
registerRichText(editor);
registerMarkdownShortcuts(editor, TRANSFORMERS);
registerDragonSupport(editor);
editor.update(
  () => {
    $getRoot().append($createParagraphNode());
    $getRoot().selectEnd();
  },
  { discrete: true }
);
mount();
function path(node: Node | null): number[] | null {
  if (!node) return null;
  const result: number[] = [];
  while (node && node !== root) {
    const parent: ParentNode | null = node.parentNode;
    if (!parent) return null;
    result.unshift(Array.prototype.indexOf.call(parent.childNodes, node));
    node = parent;
  }
  return result;
}
declare global {
  interface Window {
    compatSnapshot: () => unknown;
    compatModifySelection: (granularity: 'word' | 'lineboundary') => unknown;
  }
}
window.compatModifySelection = (granularity) => {
  const methods = createUpstreamSelectionDOMMethods(Lexical);
  let result: unknown;
  editor.update(
    () => {
      const initial = $getSelection();
      if (!$isRangeSelection(initial))
        throw new Error('Expected a real range selection');
      const expected = initial.clone();
      const actual = initial.clone();
      expected.dirty = true;
      actual.dirty = true;
      expected.modify('extend', true, granularity);
      methods.modifyDOMSelection(actual, 'extend', true, granularity);
      result = {
        equal: actual.is(expected),
        moved: !actual.isCollapsed(),
        dirtyMatches: actual.dirty === expected.dirty,
        actual: {
          anchor: actual.anchor.offset,
          focus: actual.focus.offset,
          anchorType: actual.anchor.type,
          focusType: actual.focus.type,
          dirty: actual.dirty,
        },
        expected: {
          anchor: expected.anchor.offset,
          focus: expected.focus.offset,
          anchorType: expected.anchor.type,
          focusType: expected.focus.type,
          dirty: expected.dirty,
        },
      };
    },
    { discrete: true }
  );
  return result;
};
window.compatSnapshot = () =>
  editor.read(() => {
    const selection = $getSelection();
    const dom = window.getSelection();
    return {
      model: editor.getEditorState().toJSON(),
      html: root.innerHTML,
      selection: $isRangeSelection(selection)
        ? {
            anchor: {
              key: selection.anchor.key,
              offset: selection.anchor.offset,
              type: selection.anchor.type,
            },
            focus: {
              key: selection.focus.key,
              offset: selection.focus.offset,
              type: selection.focus.type,
            },
            format: selection.format,
            style: selection.style,
          }
        : null,
      dom: dom
        ? {
            anchor: path(dom.anchorNode),
            anchorOffset: dom.anchorOffset,
            focus: path(dom.focusNode),
            focusOffset: dom.focusOffset,
          }
        : null,
    };
  });

import * as Lexical from 'lexical';
import { $updateDOMBlockCursorElement } from '../block-cursor';
import { getUpstreamRuntime } from '../test-setup';
import { createUpstreamSelectionDOMMethods } from '../tests/upstream-selection-runtime';
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

let probing = false;
const observedReadonly: boolean[] = [];
class ProbeBlock extends Lexical.ElementNode {
  static getType(): string {
    return 'probe-block';
  }
  static clone(node: ProbeBlock): ProbeBlock {
    return new ProbeBlock(node.__key);
  }
  static importJSON(serialized: Lexical.SerializedElementNode): ProbeBlock {
    return new ProbeBlock().updateFromJSON(serialized);
  }
  createDOM(): HTMLElement {
    return document.createElement('section');
  }
  updateDOM(): false {
    return false;
  }
  canBeEmpty(): false {
    if (probing) observedReadonly.push(Lexical.isCurrentlyReadOnlyMode());
    return false;
  }
  getDOMSlot(element: HTMLElement): Lexical.ElementDOMSlot<HTMLElement> {
    if (probing) observedReadonly.push(Lexical.isCurrentlyReadOnlyMode());
    return super.getDOMSlot(element);
  }
}

const root = document.querySelector<HTMLElement>('#editor');
if (!root) throw new Error('missing root');
const editor = createEditor({
  nodes: [
    HeadingNode,
    QuoteNode,
    ListNode,
    ListItemNode,
    CodeNode,
    LinkNode,
    ProbeBlock,
  ],
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
    compatProbeRestoration: (kind: 'cursor' | 'composition') => unknown;
    compatSnapshot: () => unknown;
    compatModifySelection: (
      granularity: 'character' | 'word' | 'lineboundary',
      isBackward?: boolean
    ) => unknown;
  }
}
window.compatProbeRestoration = (kind) => {
  let focusKey = '';
  editor.update(
    () => {
      const modelRoot = Lexical.$getRoot();
      modelRoot.clear();
      if (kind === 'cursor') {
        const outer = new ProbeBlock().append(
          new ProbeBlock().append(
            Lexical.$createParagraphNode().append(
              Lexical.$createTextNode('inside')
            )
          )
        );
        modelRoot.append(
          Lexical.$createParagraphNode().append(
            Lexical.$createTextNode('before')
          ),
          outer
        );
        outer.select(0, 0);
        focusKey = outer.getKey();
      } else {
        const left = Lexical.$createTextNode('left').setFormat('bold');
        const right = Lexical.$createTextNode('right');
        modelRoot.append(Lexical.$createParagraphNode().append(left, right));
        right.select(0, 0);
        focusKey = right.getKey();
      }
    },
    { discrete: true }
  );
  root.focus();
  let result: unknown;
  editor.update(
    () => {
      let selection = Lexical.$getSelection();
      if (kind === 'cursor') {
        const elementRange = Lexical.$createRangeSelection();
        elementRange.anchor.set(focusKey, 0, 'element');
        elementRange.focus.set(focusKey, 0, 'element');
        Lexical.$setSelection(elementRange);
        selection = elementRange;
      }
      if (!Lexical.$isRangeSelection(selection))
        throw new Error('Expected the real selection');
      if (kind === 'composition') Lexical.$setCompositionKey(focusKey);
      if (kind === 'cursor')
        $updateDOMBlockCursorElement(editor, root, selection);
      const cursor = editor._blockCursorElement;
      const cursorParent = cursor?.parentNode ?? null;
      const cursorNext = cursor?.nextSibling ?? null;
      const rootStyle = root.getAttribute('style');
      const html = root.outerHTML;
      const compositionKey = editor._compositionKey;
      const leaves = JSON.stringify(Array.from(editor._dirtyLeaves));
      const elements = JSON.stringify(Array.from(editor._dirtyElements));
      const dom = window.getSelection();
      if (dom === null) throw new Error('Expected the DOM selection');
      const before = [
        dom.anchorNode,
        dom.anchorOffset,
        dom.focusNode,
        dom.focusOffset,
      ];
      const value = selection.clone();
      value.dirty = true;
      observedReadonly.length = 0;
      probing = true;
      try {
        const target = createUpstreamSelectionDOMMethods(
          Lexical
        ).getDOMSelectionTarget(value, true, 'character');
        result = {
          targetPresent: target !== null,
          cursorPresent: cursor !== null,
          cursorRestored:
            editor._blockCursorElement === cursor &&
            cursor?.parentNode === cursorParent &&
            cursor?.nextSibling === cursorNext,
          styleRestored: root.getAttribute('style') === rootStyle,
          domRestored:
            root.outerHTML === html &&
            before[0] === dom.anchorNode &&
            before[1] === dom.anchorOffset &&
            before[2] === dom.focusNode &&
            before[3] === dom.focusOffset,
          compositionSeeded: compositionKey !== null,
          compositionPreserved: editor._compositionKey === compositionKey,
          modelUntouched:
            Lexical.$getSelection() === selection &&
            value.is(selection) &&
            value._cachedNodes === null &&
            leaves === JSON.stringify(Array.from(editor._dirtyLeaves)) &&
            elements === JSON.stringify(Array.from(editor._dirtyElements)),
          readonlyObserved:
            observedReadonly.length > 0 && observedReadonly.every(Boolean),
        };
      } finally {
        probing = false;
        if (kind === 'composition') Lexical.$setCompositionKey(null);
      }
    },
    { discrete: true }
  );
  return result;
};

window.compatModifySelection = (granularity, isBackward = true) => {
  const methods = createUpstreamSelectionDOMMethods(Lexical);
  let result: unknown;
  editor.update(
    () => {
      const initial = $getSelection();
      if (!$isRangeSelection(initial))
        throw new Error('Expected a real range selection');
      if (!isBackward) initial.anchor.getNode().select(2, 2);
      const origin = $getSelection();
      if (!$isRangeSelection(origin))
        throw new Error('Expected the current source range');
      const expected = origin.clone();
      const actual = origin.clone();
      expected.dirty = true;
      actual.dirty = true;
      const dom = window.getSelection();
      if (dom === null) throw new Error('Expected a real DOM selection');
      const before = [
        dom.anchorNode,
        dom.anchorOffset,
        dom.focusNode,
        dom.focusOffset,
      ];
      const html = root.outerHTML;
      const compositionKey = editor._compositionKey;
      const dirtyLeaves = Array.from(editor._dirtyLeaves);
      const dirtyElements = Array.from(editor._dirtyElements);
      const target = methods.getDOMSelectionTarget(
        actual,
        isBackward,
        granularity
      );
      const domRestored =
        before[0] === dom.anchorNode &&
        before[1] === dom.anchorOffset &&
        before[2] === dom.focusNode &&
        before[3] === dom.focusOffset &&
        html === root.outerHTML;
      const modelUntouched =
        actual.is(origin) &&
        actual.dirty &&
        actual._cachedNodes === null &&
        actual._cachedIsBackward === null &&
        $getSelection() === origin &&
        editor._compositionKey === compositionKey &&
        JSON.stringify(Array.from(editor._dirtyLeaves)) ===
          JSON.stringify(dirtyLeaves) &&
        JSON.stringify(Array.from(editor._dirtyElements)) ===
          JSON.stringify(dirtyElements);
      expected.modify('extend', isBackward, granularity);
      const [start, end] = expected.isBackward()
        ? [expected.focus, expected.anchor]
        : [expected.anchor, expected.focus];
      const targetMatches =
        target !== null &&
        target.start.key === start.key &&
        target.start.offset === start.offset &&
        target.start.type === start.type &&
        target.end.key === end.key &&
        target.end.offset === end.offset &&
        target.end.type === end.type &&
        target.backwardInDOM === expected.isBackward();
      methods.modifyDOMSelection(actual, 'extend', isBackward, granularity);
      result = {
        targetMatches,
        domRestored,
        modelUntouched,
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

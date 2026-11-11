/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type { EditorThemeClasses } from 'lexical';
import { $isDecoratorNode, $isElementNode, $isRangeSelection } from './runtime';
import type { BaseSelection } from './selection';
import { normalizeClassNames } from './support';
import type {
  CompatEditorConfig as EditorConfig,
  CompatEditor as LexicalEditor,
  CompatNode as LexicalNode,
} from './types';
import { $getDOMSlot } from './utils';

export function getCachedClassNameArray(
  classNamesTheme: EditorThemeClasses,
  classNameThemeType: string
): Array<string> {
  if (classNamesTheme.__lexicalClassNameCache === undefined) {
    classNamesTheme.__lexicalClassNameCache = {};
  }
  const classNamesCache = classNamesTheme.__lexicalClassNameCache;
  const cachedClassNames = classNamesCache[classNameThemeType];
  if (cachedClassNames !== undefined) {
    return cachedClassNames;
  }
  const classNames = classNamesTheme[classNameThemeType];
  // As we're using classList, we need
  // to handle className tokens that have spaces.
  // The easiest way to do this to convert the
  // className tokens to an array that can be
  // applied to classList.add()/remove().
  if (typeof classNames === 'string') {
    const classNamesArr = normalizeClassNames(classNames);
    classNamesCache[classNameThemeType] = classNamesArr;
    return classNamesArr;
  }
  return classNames;
}

export function createBlockCursorElement(
  editorConfig: EditorConfig
): HTMLDivElement {
  const theme = editorConfig.theme;
  const element = document.createElement('div');
  element.contentEditable = 'false';
  element.setAttribute('data-lexical-cursor', 'true');
  let blockCursorTheme = theme.blockCursor;
  if (blockCursorTheme !== undefined) {
    if (typeof blockCursorTheme === 'string') {
      const classNamesArr = normalizeClassNames(blockCursorTheme);
      // @ts-expect-error: intentional
      blockCursorTheme = theme.blockCursor = classNamesArr;
    }
    if (blockCursorTheme !== undefined) {
      element.classList.add(...blockCursorTheme);
    }
  }
  return element;
}

export function needsBlockCursor(node: null | LexicalNode): boolean {
  return (
    ($isDecoratorNode(node) || ($isElementNode(node) && !node.canBeEmpty())) &&
    !node.isInline()
  );
}

export function removeDOMBlockCursorElement(
  blockCursorElement: HTMLElement,
  editor: LexicalEditor,
  rootElement: HTMLElement
) {
  rootElement.style.removeProperty('caret-color');
  editor._blockCursorElement = null;
  const parentElement = blockCursorElement.parentElement;
  if (parentElement !== null) {
    parentElement.removeChild(blockCursorElement);
  }
}

export function $updateDOMBlockCursorElement(
  editor: LexicalEditor,
  rootElement: HTMLElement,
  nextSelection: null | BaseSelection
): void {
  let blockCursorElement = editor._blockCursorElement;

  if (
    $isRangeSelection(nextSelection) &&
    nextSelection.isCollapsed() &&
    nextSelection.anchor.type === 'element' &&
    rootElement.contains(document.activeElement)
  ) {
    const anchor = nextSelection.anchor;
    const elementNode = anchor.getNode();
    const offset = anchor.offset;
    const elementNodeSize = elementNode.getChildrenSize();
    let isBlockCursor = false;
    let insertBeforeElement: null | HTMLElement = null;

    if (offset === elementNodeSize) {
      const child = elementNode.getChildAtIndex(offset - 1);
      if (needsBlockCursor(child)) {
        isBlockCursor = true;
      }
    } else {
      const child = elementNode.getChildAtIndex(offset);
      if (child !== null && needsBlockCursor(child)) {
        const sibling = child.getPreviousSibling();
        if (sibling === null || needsBlockCursor(sibling)) {
          isBlockCursor = true;
          insertBeforeElement = editor.getElementByKey(child.__key);
        }
      }
    }
    if (isBlockCursor) {
      // Route through the slot so the cursor lands in the content-bearing
      // element. For a node whose `getDOMSlot` wraps its content, the keyed
      // DOM is the wrapper but the managed children (and `insertBeforeElement`)
      // live in `slot.element`; inserting into the keyed wrapper would throw
      // because the reference node is not its child.
      const elementDOM = $getDOMSlot(
        elementNode,
        editor.getElementByKey(elementNode.__key) as HTMLElement,
        editor
      ).element;
      if (blockCursorElement === null) {
        editor._blockCursorElement = blockCursorElement =
          createBlockCursorElement(editor._config);
      }
      rootElement.style.caretColor = 'transparent';
      if (insertBeforeElement === null) {
        elementDOM.appendChild(blockCursorElement);
      } else {
        elementDOM.insertBefore(blockCursorElement, insertBeforeElement);
      }
      return;
    }
  }
  // Remove cursor
  if (blockCursorElement !== null) {
    removeDOMBlockCursorElement(blockCursorElement, editor, rootElement);
  }
}

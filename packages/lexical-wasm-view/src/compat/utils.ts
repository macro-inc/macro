/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * MIT licensed; see ../../LICENSE. Retargeted from lexical@0.45.0.
 */
import type { NodeKey } from 'lexical';
import {
  COMPOSITION_START_CHAR,
  COMPOSITION_SUFFIX,
  DOM_DOCUMENT_TYPE,
  DOM_TEXT_TYPE,
} from './constants';
import {
  getDOMSelection,
  getParentElement,
  getWindow,
  isDOMNode,
  isHTMLElement,
} from './dom-utils';
import { IS_APPLE, IS_APPLE_WEBKIT, IS_IOS, IS_SAFARI } from './environment';
import { flushRootMutations } from './mutations';
import {
  $createTextNode,
  $getCompositionKey,
  $getNodeByKey,
  $getPreviousSelection,
  $getSelection,
  $getTextNodeOffset,
  $isDecoratorNode,
  $isElementNode,
  $isRangeSelection,
  $isTabNode,
  $isTextNode,
  $setCompositionKey,
  errorOnReadOnly,
  getActiveEditor,
  isLexicalEditor,
  type RangeSelection,
  replaceNode,
} from './runtime';
import type { BaseSelection } from './selection';
import type {
  CompatEditorState as EditorState,
  CompatEditor as LexicalEditor,
  CompatNode as LexicalNode,
  CompatRootNode as RootNode,
  CompatTextNode as TextNode,
} from './types';

export function $isSelectionCapturedInDecorator(node: Node): boolean {
  return $isDecoratorNode($getNearestNodeFromDOMNode(node));
}

export function isSelectionCapturedInDecoratorInput(anchorDOM: Node): boolean {
  const activeElement = document.activeElement;

  if (!isHTMLElement(activeElement)) {
    return false;
  }
  const nodeName = activeElement.nodeName;

  return (
    $isDecoratorNode($getNearestNodeFromDOMNode(anchorDOM)) &&
    (nodeName === 'INPUT' ||
      nodeName === 'TEXTAREA' ||
      (activeElement.contentEditable === 'true' &&
        getEditorPropertyFromDOMNode(activeElement) == null))
  );
}

export function isSelectionWithinEditor(
  editor: LexicalEditor,
  anchorDOM: null | Node,
  focusDOM: null | Node
): boolean {
  const rootElement = editor.getRootElement();
  try {
    return (
      rootElement !== null &&
      rootElement.contains(anchorDOM) &&
      rootElement.contains(focusDOM) &&
      // Ignore if selection is within nested editor
      anchorDOM !== null &&
      !isSelectionCapturedInDecoratorInput(anchorDOM) &&
      getNearestEditorFromDOMNode(anchorDOM) === editor
    );
  } catch (_error) {
    return false;
  }
}

export function getNearestEditorFromDOMNode(
  node: Node | null
): LexicalEditor | null {
  let currentNode = node;
  while (currentNode != null) {
    const editor = getEditorPropertyFromDOMNode(currentNode);
    if (isLexicalEditor(editor)) {
      return editor;
    }
    currentNode = getParentElement(currentNode);
  }
  return null;
}

/** @internal */
export function getEditorPropertyFromDOMNode(node: Node | null): unknown {
  // @ts-expect-error: internal field
  return node ? node.__lexicalEditor : null;
}

/**
 * Return true if the TextNode is a TabNode or is in token mode.
 */
export function $isTokenOrTab(node: TextNode): boolean {
  // The internal call subset intentionally has no Tab-only methods.
  const isTab: boolean = $isTabNode(node);
  return isTab || node.isToken();
}

/**
 * Return true if the TextNode is a TabNode, or is in token or segmented mode.
 */
export function $isTokenOrSegmented(node: TextNode): boolean {
  return $isTokenOrTab(node) || node.isSegmented();
}

/**
 * @param node - The element being tested
 * @returns Returns true if node is an DOM Text node, false otherwise.
 */
export function isDOMTextNode(node: unknown): node is Text {
  return isDOMNode(node) && node.nodeType === DOM_TEXT_TYPE;
}

/**
 * @param node - The element being tested
 * @returns Returns true if node is an DOM Document node, false otherwise.
 */
export function isDOMDocumentNode(node: unknown): node is Document {
  return isDOMNode(node) && node.nodeType === DOM_DOCUMENT_TYPE;
}

export function getDOMTextNode(element: Node | null): Text | null {
  let node = element;
  while (node != null) {
    if (isDOMTextNode(node)) {
      return node;
    }
    node = node.firstChild;
  }
  return null;
}

export function $getNodeFromDOMNode(
  dom: Node,
  editorState?: EditorState
): LexicalNode | null {
  const editor = getActiveEditor();
  const key = getNodeKeyFromDOMNode(dom, editor);
  if (key !== undefined) {
    return $getNodeByKey(key, editorState);
  }
  return null;
}

export function setNodeKeyOnDOMNode(
  dom: Node,
  editor: LexicalEditor,
  key: NodeKey
) {
  const prop = `__lexicalKey_${editor._key}`;
  (dom as Node & Record<typeof prop, NodeKey | undefined>)[prop] = key;
}

export function getNodeKeyFromDOMNode(
  dom: Node,
  editor: LexicalEditor
): NodeKey | undefined {
  const prop = `__lexicalKey_${editor._key}`;
  return (dom as Node & Record<typeof prop, NodeKey | undefined>)[prop];
}

export function $getNearestNodeFromDOMNode(
  startingDOM: Node,
  editorState?: EditorState
): LexicalNode | null {
  let dom: Node | null = startingDOM;
  while (dom != null) {
    const node = $getNodeFromDOMNode(dom, editorState);
    if (node !== null) {
      return node;
    }
    dom = getParentElement(dom);
  }
  return null;
}

export function cloneDecorators(
  editor: LexicalEditor
): Record<NodeKey, unknown> {
  const currentDecorators = editor._decorators;
  const pendingDecorators = Object.assign({}, currentDecorators);
  editor._pendingDecorators = pendingDecorators;
  return pendingDecorators;
}

/** Remove an authoritative destroyed key, without scanning unrelated entries. */
export function removeDecorator(editor: LexicalEditor, key: NodeKey): void {
  const decorators = editor._pendingDecorators ?? editor._decorators;
  if (Object.hasOwn(decorators, key)) {
    const pending = editor._pendingDecorators ?? cloneDecorators(editor);
    delete pending[key];
  }
}

export function internalGetRoot(editorState: EditorState): RootNode {
  return editorState._nodeMap.get('root') as RootNode;
}

export function $flushMutations(): void {
  errorOnReadOnly();
  const editor = getActiveEditor();
  flushRootMutations(editor);
}

export function $getNodeFromDOM(dom: Node): null | LexicalNode {
  const editor = getActiveEditor();
  const nodeKey = getNodeKeyFromDOMTree(dom, editor);
  if (nodeKey === null) {
    const rootElement = editor.getRootElement();
    if (dom === rootElement) {
      return $getNodeByKey('root');
    }
    return null;
  }
  return $getNodeByKey(nodeKey);
}

export function getNodeKeyFromDOMTree(
  // Note that node here refers to a DOM Node, not an Lexical Node
  dom: Node,
  editor: LexicalEditor
): NodeKey | null {
  let node: Node | null = dom;
  while (node != null) {
    const key = getNodeKeyFromDOMNode(node, editor);
    if (key !== undefined) {
      return key;
    }
    node = getParentElement(node);
  }
  return null;
}

/**
 * Return true if `str` contains any valid surrogate pair.
 *
 * See also $updateCaretSelectionForUnicodeCharacter for
 * a discussion on when and why this is useful.
 */
export function doesContainSurrogatePair(str: string): boolean {
  return /[\uD800-\uDBFF][\uDC00-\uDFFF]/g.test(str);
}

export function getEditorsToPropagate(
  editor: LexicalEditor
): Array<LexicalEditor> {
  const editorsToPropagate: LexicalEditor[] = [];
  for (
    let currentEditor: LexicalEditor | null = editor;
    currentEditor !== null;
    currentEditor = currentEditor._parentEditor
  ) {
    editorsToPropagate.push(currentEditor);
  }
  return editorsToPropagate;
}

export function getAnchorTextFromDOM(anchorNode: Node): null | string {
  return isDOMTextNode(anchorNode) ? anchorNode.nodeValue : null;
}

export function $updateSelectedTextFromDOM(
  isCompositionEnd: boolean,
  editor: LexicalEditor,
  data?: string
): void {
  // Update the text content with the latest composition text
  const domSelection = getDOMSelection(getWindow(editor));
  if (domSelection === null) {
    return;
  }
  const anchorNode = domSelection.anchorNode;
  let { anchorOffset, focusOffset } = domSelection;
  if (anchorNode !== null) {
    let textContent = getAnchorTextFromDOM(anchorNode);
    const node = $getNearestNodeFromDOMNode(anchorNode);
    if (textContent !== null && $isTextNode(node)) {
      // Data is intentionally truthy, as we check for boolean, null and empty string.
      if (
        (textContent === COMPOSITION_SUFFIX ||
          textContent === COMPOSITION_START_CHAR) &&
        data
      ) {
        const offset = data.length;
        textContent = data;
        anchorOffset = offset;
        focusOffset = offset;
      }

      if (textContent !== null) {
        $updateTextNodeFromDOMContent(
          node,
          textContent,
          anchorOffset,
          focusOffset,
          isCompositionEnd
        );
      }
    }
  }
}

export function $updateTextNodeFromDOMContent(
  textNode: TextNode,
  textContent: string,
  anchorOffset: null | number,
  focusOffset: null | number,
  compositionEnd: boolean
): void {
  let node = textNode;

  if (node.isAttached() && (compositionEnd || !node.isDirty())) {
    const isComposing = node.isComposing();
    let normalizedTextContent = textContent;

    if (isComposing || compositionEnd) {
      if (textContent.endsWith(COMPOSITION_SUFFIX)) {
        normalizedTextContent = textContent.slice(
          0,
          -COMPOSITION_SUFFIX.length
        );
      }
      if (compositionEnd) {
        const char = COMPOSITION_START_CHAR;
        let index = normalizedTextContent.indexOf(char);
        while (index !== -1) {
          normalizedTextContent =
            normalizedTextContent.slice(0, index) +
            normalizedTextContent.slice(index + char.length);
          index = normalizedTextContent.indexOf(char);

          if (anchorOffset !== null && anchorOffset > index) {
            anchorOffset = Math.max(index, anchorOffset - char.length);
          }

          if (focusOffset !== null && focusOffset > index) {
            focusOffset = Math.max(index, focusOffset - char.length);
          }
        }
      }
    }
    const prevTextContent = node.getTextContent();

    if (compositionEnd || normalizedTextContent !== prevTextContent) {
      if (normalizedTextContent === '') {
        $setCompositionKey(null);
        if (!IS_SAFARI && !IS_IOS && !IS_APPLE_WEBKIT) {
          // For composition (mainly Android), we have to remove the node on a later update
          const editor = getActiveEditor();
          setTimeout(() => {
            editor.update(() => {
              if (node.isAttached()) {
                node.remove();
              }
            });
          }, 20);
        } else {
          node.remove();
        }
        return;
      }
      const parent = node.getParent();
      const prevSelection = $getPreviousSelection();
      const prevTextContentSize = node.getTextContentSize();
      const compositionKey = $getCompositionKey();
      const nodeKey = node.getKey();

      if (
        node.isToken() ||
        (compositionKey !== null &&
          nodeKey === compositionKey &&
          !isComposing) ||
        // Check if character was added at the start or boundaries when not insertable, and we need
        // to clear this input from occurring as that action wasn't permitted.
        ($isRangeSelection(prevSelection) &&
          ((parent !== null &&
            !parent.canInsertTextBefore() &&
            prevSelection.anchor.offset === 0) ||
            (prevSelection.anchor.key === textNode.__key &&
              prevSelection.anchor.offset === 0 &&
              !node.canInsertTextBefore() &&
              !isComposing) ||
            (prevSelection.focus.key === textNode.__key &&
              prevSelection.focus.offset === prevTextContentSize &&
              !node.canInsertTextAfter() &&
              !isComposing)))
      ) {
        node.markDirty();
        return;
      }
      const selection = $getSelection();

      if (
        !$isRangeSelection(selection) ||
        anchorOffset === null ||
        focusOffset === null
      ) {
        $setTextContentWithSelection(node, normalizedTextContent, selection);
        return;
      }
      selection.setTextNodeRange(node, anchorOffset, node, focusOffset);

      if (node.isSegmented()) {
        const originalTextContent = node.getTextContent();
        const replacement = $createTextNode(originalTextContent);
        replaceNode(node, replacement);
        node = replacement;
      }
      $setTextContentWithSelection(node, normalizedTextContent, selection);
    }
  }
}

export function $setTextContentWithSelection(
  node: TextNode,
  textContent: string,
  selection: BaseSelection | null
) {
  node.setTextContent(textContent);
  if ($isRangeSelection(selection)) {
    const key = node.getKey();
    let pointMutated = false;
    for (const k of ['anchor', 'focus'] as const) {
      const pt = selection[k];
      if (pt.type === 'text' && pt.key === key) {
        pt.offset = $getTextNodeOffset(node, pt.offset, 'clamp');
        pointMutated = true;
      }
    }
    if (pointMutated) {
      selection._cachedNodes = null;
      selection._cachedIsBackward = null;
    }
  }
}

export function $previousSiblingDoesNotAcceptText(node: TextNode): boolean {
  const previousSibling = node.getPreviousSibling();

  return (
    ($isTextNode(previousSibling) ||
      ($isElementNode(previousSibling) && previousSibling.isInline())) &&
    !previousSibling.canInsertTextAfter()
  );
}

// This function is connected to $shouldPreventDefaultAndInsertText and determines whether the
// TextNode boundaries are writable or we should use the previous/next sibling instead. For example,
// in the case of a LinkNode, boundaries are not writable.
export function $shouldInsertTextAfterOrBeforeTextNode(
  selection: RangeSelection,
  node: TextNode
): boolean {
  if (node.isSegmented()) {
    return true;
  }
  if (!selection.isCollapsed()) {
    return false;
  }
  const offset = selection.anchor.offset;
  const parent = node.getParentOrThrow();
  const isToken = $isTokenOrTab(node);
  if (offset === 0) {
    return (
      !node.canInsertTextBefore() ||
      (!parent.canInsertTextBefore() && !node.isComposing()) ||
      isToken ||
      $previousSiblingDoesNotAcceptText(node)
    );
  } else if (offset === node.getTextContentSize()) {
    return (
      !node.canInsertTextAfter() ||
      (!parent.canInsertTextAfter() && !node.isComposing()) ||
      isToken
    );
  } else {
    return false;
  }
}

/**
 * A KeyboardEvent or structurally similar object with a string `key` as well
 * as `altKey`, `ctrlKey`, `metaKey`, and `shiftKey` boolean properties.
 */
export type KeyboardEventModifiers = Pick<
  KeyboardEvent,
  'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'
>;

/**
 * A record of keyboard modifiers that must be enabled.
 * If the value is `'any'` then the modifier key's state is ignored.
 * If the value is `true` then the modifier key must be pressed.
 * If the value is `false` or the property is omitted then the modifier key must
 * not be pressed.
 */
export type KeyboardEventModifierMask = {
  [K in Exclude<keyof KeyboardEventModifiers, 'key'>]?:
    | boolean
    | undefined
    | 'any';
};

export function matchModifier(
  event: KeyboardEventModifiers,
  mask: KeyboardEventModifierMask,
  prop: keyof KeyboardEventModifierMask
): boolean {
  const expected = mask[prop] || false;
  return expected === 'any' || expected === event[prop];
}

/**
 * Match a KeyboardEvent with its expected modifier state
 *
 * @param event A KeyboardEvent, or structurally similar object
 * @param mask An object specifying the expected state of the modifiers
 * @returns true if the event matches
 */
export function isModifierMatch(
  event: KeyboardEventModifiers,
  mask: KeyboardEventModifierMask
): boolean {
  return (
    matchModifier(event, mask, 'altKey') &&
    matchModifier(event, mask, 'ctrlKey') &&
    matchModifier(event, mask, 'shiftKey') &&
    matchModifier(event, mask, 'metaKey')
  );
}

/**
 * Match a KeyboardEvent with its expected state
 *
 * @param event A KeyboardEvent, or structurally similar object
 * @param expectedKey The string to compare with event.key (case insensitive)
 * @param mask An object specifying the expected state of the modifiers
 * @returns true if the event matches
 */
export function isExactShortcutMatch(
  event: KeyboardEventModifiers,
  expectedKey: string,
  mask: KeyboardEventModifierMask
): boolean {
  if (!isModifierMatch(event, mask)) {
    return false;
  }

  if (event.key.toLowerCase() === expectedKey.toLowerCase()) {
    // For special keys like Enter, Tab, ArrowUp, etc.
    // For default keys with English-based keyboard layout.
    return true;
  }

  if (expectedKey.length > 1) {
    // For non English-based keyboard layout but the key is a special key, we must not match it by `event.code`.
    return false;
  }

  if (event.key.length === 1 && event.key.charCodeAt(0) <= 127) {
    // For ASCII keys we must not match it by `event.code` because it would break remapped layouts (English (US) Dvorak, etc.).
    return false;
  }

  // Fallback for number keys
  if (event.code.startsWith('Digit') && /^\d$/.test(expectedKey)) {
    return event.code === `Digit${expectedKey}`;
  }

  const expectedCode = 'Key' + expectedKey.toUpperCase();

  // For default keys with not English-based keyboard layouts where `event.key` is non-ASCII, match by `event.code`.
  return event.code === expectedCode;
}

export const CONTROL_OR_META = { ctrlKey: !IS_APPLE, metaKey: IS_APPLE };

export const CONTROL_OR_ALT = { altKey: IS_APPLE, ctrlKey: !IS_APPLE };

export function isTab(event: KeyboardEventModifiers): boolean {
  return isExactShortcutMatch(event, 'Tab', {
    shiftKey: 'any',
  });
}

export function isBold(event: KeyboardEventModifiers): boolean {
  return isExactShortcutMatch(event, 'b', CONTROL_OR_META);
}

export function isItalic(event: KeyboardEventModifiers): boolean {
  return isExactShortcutMatch(event, 'i', CONTROL_OR_META);
}

export function isUnderline(event: KeyboardEventModifiers): boolean {
  return isExactShortcutMatch(event, 'u', CONTROL_OR_META);
}

export function isParagraph(event: KeyboardEventModifiers): boolean {
  return isExactShortcutMatch(event, 'Enter', {
    altKey: 'any',
    ctrlKey: 'any',
    metaKey: 'any',
  });
}

export function isLineBreak(event: KeyboardEventModifiers): boolean {
  return isExactShortcutMatch(event, 'Enter', {
    altKey: 'any',
    ctrlKey: 'any',
    metaKey: 'any',
    shiftKey: true,
  });
}

// Inserts a new line after the selection

export function isOpenLineBreak(event: KeyboardEventModifiers): boolean {
  // 79 = KeyO
  return IS_APPLE && isExactShortcutMatch(event, 'o', { ctrlKey: true });
}

export function isDeleteWordBackward(event: KeyboardEventModifiers): boolean {
  return isExactShortcutMatch(event, 'Backspace', CONTROL_OR_ALT);
}

export function isDeleteWordForward(event: KeyboardEventModifiers): boolean {
  return isExactShortcutMatch(event, 'Delete', CONTROL_OR_ALT);
}

export function isDeleteLineBackward(event: KeyboardEventModifiers): boolean {
  return (
    IS_APPLE && isExactShortcutMatch(event, 'Backspace', { metaKey: true })
  );
}

export function isDeleteLineForward(event: KeyboardEventModifiers): boolean {
  return (
    IS_APPLE &&
    (isExactShortcutMatch(event, 'Delete', { metaKey: true }) ||
      isExactShortcutMatch(event, 'k', { ctrlKey: true }))
  );
}
export {
  $createChildrenArray,
  $findMatchingParent,
  $getAdjacentNode,
  $getDOMSlot,
  $getDOMTextNode,
  $getEditorDOMRenderConfig,
  $isElementDOMSlot,
  $isRootOrShadowRoot,
  getDefaultView,
  getDOMOwnerDocument,
  getDOMSelection,
  getDOMSelectionFromTarget,
  getElementByKeyOrThrow,
  getParentElement,
  getWindow,
  isBackspace,
  isCopy,
  isCut,
  isDelete,
  isDeleteBackward,
  isDeleteForward,
  isDOMNode,
  isDOMUnmanaged,
  isDocumentFragment,
  isEscape,
  isFirefoxClipboardEvents,
  isHTMLElement,
  isModifier,
  isMoveBackward,
  isMoveDown,
  isMoveForward,
  isMoveToEnd,
  isMoveToStart,
  isMoveUp,
  isRedo,
  isSelectAll,
  isSpace,
  isUndo,
  resolveElement,
  type ShadowRootNode,
  ShadowRootNodeBrand,
  scrollIntoViewIfNeeded,
  setMutatedNode,
} from './dom-utils';

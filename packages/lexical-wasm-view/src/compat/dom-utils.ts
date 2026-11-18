/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * MIT licensed; see ../../LICENSE. Retargeted from lexical@0.45.0.
 */
import type { NodeKey, NodeMutation, Spread } from 'lexical';
import { DOM_DOCUMENT_FRAGMENT_TYPE, DOM_ELEMENT_TYPE } from './constants';
import { type DOMSlot, ElementDOMSlot } from './dom-slot';
import { CAN_USE_DOM, IS_APPLE } from './environment';
import {
  $getEditor,
  $getNodeByKey,
  $isElementNode,
  $isRootNode,
  getEditorDOMRenderConfig,
} from './runtime';
import type { PointType } from './selection';
import { invariant } from './support';
import type {
  CompatDOMSlotForNode as DOMSlotForNode,
  CompatDOMRenderConfig as EditorDOMRenderConfig,
  CompatElementNode as ElementNode,
  CompatEditor as LexicalEditor,
  CompatNode as LexicalNode,
  LexicalPrivateDOM,
  MutatedNodes,
  MutationListeners,
  CompatNodeMap as NodeMap,
  RegisteredNodes,
  CompatRootNode as RootNode,
  CompatTextNode as TextNode,
} from './types';
import {
  CONTROL_OR_META,
  getDOMTextNode,
  isDOMDocumentNode,
  isExactShortcutMatch,
  type KeyboardEventModifiers,
} from './utils';

export function isDeleteBackward(event: KeyboardEventModifiers): boolean {
  return (
    isExactShortcutMatch(event, 'Backspace', { shiftKey: 'any' }) ||
    (IS_APPLE && isExactShortcutMatch(event, 'h', { ctrlKey: true }))
  );
}

export function isDeleteForward(event: KeyboardEventModifiers): boolean {
  return (
    isExactShortcutMatch(event, 'Delete', {}) ||
    (IS_APPLE && isExactShortcutMatch(event, 'd', { ctrlKey: true }))
  );
}

export function isUndo(event: KeyboardEventModifiers): boolean {
  return isExactShortcutMatch(event, 'z', CONTROL_OR_META);
}

export function isRedo(event: KeyboardEventModifiers): boolean {
  if (IS_APPLE) {
    return isExactShortcutMatch(event, 'z', { metaKey: true, shiftKey: true });
  }
  return (
    isExactShortcutMatch(event, 'y', { ctrlKey: true }) ||
    isExactShortcutMatch(event, 'z', { ctrlKey: true, shiftKey: true })
  );
}

export function isCopy(event: KeyboardEventModifiers): boolean {
  return isExactShortcutMatch(event, 'c', CONTROL_OR_META);
}

export function isCut(event: KeyboardEventModifiers): boolean {
  return isExactShortcutMatch(event, 'x', CONTROL_OR_META);
}

export function isMoveBackward(event: KeyboardEventModifiers): boolean {
  return isExactShortcutMatch(event, 'ArrowLeft', {
    shiftKey: 'any',
  });
}

export function isMoveToStart(event: KeyboardEventModifiers): boolean {
  return isExactShortcutMatch(event, 'ArrowLeft', {
    ...CONTROL_OR_META,
    shiftKey: 'any',
  });
}

export function isMoveForward(event: KeyboardEventModifiers): boolean {
  return isExactShortcutMatch(event, 'ArrowRight', {
    shiftKey: 'any',
  });
}

export function isMoveToEnd(event: KeyboardEventModifiers): boolean {
  return isExactShortcutMatch(event, 'ArrowRight', {
    ...CONTROL_OR_META,
    shiftKey: 'any',
  });
}

export function isMoveUp(event: KeyboardEventModifiers): boolean {
  return isExactShortcutMatch(event, 'ArrowUp', {
    altKey: 'any',
    shiftKey: 'any',
  });
}

export function isMoveDown(event: KeyboardEventModifiers): boolean {
  return isExactShortcutMatch(event, 'ArrowDown', {
    altKey: 'any',
    shiftKey: 'any',
  });
}

export function isModifier(event: KeyboardEventModifiers): boolean {
  return event.ctrlKey || event.shiftKey || event.altKey || event.metaKey;
}

export function isSpace(event: KeyboardEventModifiers): boolean {
  return event.key === ' ';
}

export function isBackspace(event: KeyboardEventModifiers): boolean {
  return event.key === 'Backspace';
}

export function isEscape(event: KeyboardEventModifiers): boolean {
  return event.key === 'Escape';
}

export function isDelete(event: KeyboardEventModifiers): boolean {
  return event.key === 'Delete';
}

export function isSelectAll(event: KeyboardEventModifiers): boolean {
  return isExactShortcutMatch(event, 'a', CONTROL_OR_META);
}

export function setMutatedNode(
  mutatedNodes: MutatedNodes,
  registeredNodes: RegisteredNodes,
  mutationListeners: MutationListeners,
  node: LexicalNode,
  mutation: NodeMutation
) {
  if (mutationListeners.size === 0) {
    return;
  }
  const nodeType = node.__type;
  const nodeKey = node.__key;
  const registeredNode = registeredNodes.get(nodeType);
  if (registeredNode === undefined) {
    invariant(false, 'Type %s not in registeredNodes', nodeType);
  }
  const klass = registeredNode.klass;
  let mutatedNodesByType = mutatedNodes.get(klass);
  if (mutatedNodesByType === undefined) {
    mutatedNodesByType = new Map();
    mutatedNodes.set(klass, mutatedNodesByType);
  }
  const prevMutation = mutatedNodesByType.get(nodeKey);
  // If the node has already been "destroyed", yet we are
  // re-making it, then this means a move likely happened.
  // We should change the mutation to be that of "updated"
  // instead.
  const isMove = prevMutation === 'destroyed' && mutation === 'created';
  if (prevMutation === undefined || isMove) {
    mutatedNodesByType.set(nodeKey, isMove ? 'updated' : mutation);
  }
}

export function resolveElement(
  element: ElementNode,
  isBackward: boolean,
  focusOffset: number
): LexicalNode | null {
  const parent = element.getParent();
  let offset = focusOffset;
  let block = element;
  if (parent !== null) {
    if (isBackward && focusOffset === 0) {
      offset = block.getIndexWithinParent();
      block = parent;
    } else if (!isBackward && focusOffset === block.getChildrenSize()) {
      offset = block.getIndexWithinParent() + 1;
      block = parent;
    }
  }
  return block.getChildAtIndex(isBackward ? offset - 1 : offset);
}

export function $getAdjacentNode(
  focus: PointType,
  isBackward: boolean
): null | LexicalNode {
  const focusOffset = focus.offset;
  if (focus.type === 'element') {
    const block = focus.getNode();
    return resolveElement(block, isBackward, focusOffset);
  } else {
    const focusNode = focus.getNode();
    if (
      (isBackward && focusOffset === 0) ||
      (!isBackward && focusOffset === focusNode.getTextContentSize())
    ) {
      const possibleNode = isBackward
        ? focusNode.getPreviousSibling()
        : focusNode.getNextSibling();
      if (possibleNode === null) {
        return resolveElement(
          focusNode.getParentOrThrow(),
          isBackward,
          focusNode.getIndexWithinParent() + (isBackward ? 0 : 1)
        );
      }
      return possibleNode;
    }
  }
  return null;
}

export function isFirefoxClipboardEvents(editor: LexicalEditor): boolean {
  const event = getWindow(editor).event;
  const inputType = event && (event as InputEvent).inputType;
  return (
    inputType === 'insertFromPaste' ||
    inputType === 'insertFromPasteAsQuotation'
  );
}

export function getElementByKeyOrThrow(
  editor: LexicalEditor,
  key: NodeKey
): HTMLElement {
  const element = editor._keyToDOMMap.get(key);

  if (element === undefined) {
    invariant(
      false,
      'Reconciliation: could not find DOM element for node key %s',
      key
    );
  }

  return element;
}

export function getParentElement(node: Node): HTMLElement | null {
  const parentElement =
    (node as HTMLSlotElement).assignedSlot || node.parentElement;
  return isDocumentFragment(parentElement)
    ? ((parentElement as unknown as ShadowRoot).host as HTMLElement)
    : parentElement;
}

export function getDOMOwnerDocument(
  target: EventTarget | null
): Document | null {
  return isDOMDocumentNode(target)
    ? target
    : isHTMLElement(target)
      ? target.ownerDocument
      : null;
}

export function scrollIntoViewIfNeeded(
  editor: LexicalEditor,
  selectionRect: DOMRect,
  rootElement: HTMLElement
): void {
  const doc = getDOMOwnerDocument(rootElement);
  const defaultView = getDefaultView(doc);

  if (doc === null || defaultView === null) {
    return;
  }
  let { top: currentTop, bottom: currentBottom } = selectionRect;
  let targetTop = 0;
  let targetBottom = 0;
  let element: HTMLElement | null = rootElement;

  while (element !== null) {
    const isBodyElement = element === doc.body;
    if (isBodyElement) {
      // On mobile, the on-screen keyboard shrinks the visual viewport but
      // not the layout viewport (innerHeight).
      // selectionRect comes from getBoundingClientRect in layout-viewport coords,
      // so we must compare against visualViewport bounds,
      // or the caret stays behind the keyboard.
      const visualViewport = defaultView.visualViewport;
      if (visualViewport) {
        const offsetTop = visualViewport.offsetTop;
        targetTop = offsetTop;
        targetBottom = offsetTop + visualViewport.height;
      } else {
        targetTop = 0;
        targetBottom = getWindow(editor).innerHeight;
      }
      // Account for CSS scroll-padding on the document element
      const computedStyle = defaultView.getComputedStyle(doc.documentElement);
      const scrollPaddingTop = parseFloat(computedStyle.scrollPaddingTop);
      const scrollPaddingBottom = parseFloat(computedStyle.scrollPaddingBottom);
      if (Number.isFinite(scrollPaddingTop)) {
        targetTop += scrollPaddingTop;
      }
      if (Number.isFinite(scrollPaddingBottom)) {
        targetBottom -= scrollPaddingBottom;
      }
    } else {
      const targetRect = element.getBoundingClientRect();
      targetTop = targetRect.top;
      targetBottom = targetRect.bottom;
    }
    let diff = 0;

    if (currentTop < targetTop) {
      diff = -(targetTop - currentTop);
    } else if (currentBottom > targetBottom) {
      diff = currentBottom - targetBottom;
    }

    if (diff !== 0) {
      if (isBodyElement) {
        // Only handles scrolling of Y axis
        defaultView.scrollBy(0, diff);
      } else {
        const scrollTop = element.scrollTop;
        element.scrollTop += diff;
        const yOffset = element.scrollTop - scrollTop;
        currentTop -= yOffset;
        currentBottom -= yOffset;
      }
    }
    if (isBodyElement) {
      break;
    }
    element = getParentElement(element);
  }
}

export function getDefaultView(domElem: EventTarget | null): Window | null {
  const ownerDoc = getDOMOwnerDocument(domElem);
  return ownerDoc ? ownerDoc.defaultView : null;
}

export function getWindow(editor: LexicalEditor): Window {
  const windowObj = editor._window;
  if (windowObj === null) {
    invariant(false, 'window object not found');
  }
  return windowObj;
}

export const ShadowRootNodeBrand: unique symbol = Symbol.for(
  '@lexical/ShadowRootNodeBrand'
);

export type ShadowRootNode = Spread<
  { isShadowRoot(): true; [ShadowRootNodeBrand]: never },
  ElementNode
>;

export function $isRootOrShadowRoot(
  node: null | LexicalNode
): node is RootNode | ShadowRootNode {
  return $isRootNode(node) || ($isElementNode(node) && node.isShadowRoot());
}

/**
 * Returns the selection for the given window, or the global window if null.
 * Will return null if {@link CAN_USE_DOM} is false.
 *
 * @param targetWindow The window to get the selection from
 * @returns a Selection or null
 */
export function getDOMSelection(targetWindow: null | Window): null | Selection {
  return !CAN_USE_DOM ? null : (targetWindow || window).getSelection();
}

/**
 * Returns the selection for the defaultView of the ownerDocument of given EventTarget.
 *
 * @param eventTarget The node to get the selection from
 * @returns a Selection or null
 */
export function getDOMSelectionFromTarget(
  eventTarget: null | EventTarget
): null | Selection {
  const defaultView = getDefaultView(eventTarget);
  return defaultView ? defaultView.getSelection() : null;
}

/**
 * @param x - The element being tested
 * @returns Returns true if x is an HTML element, false otherwise.
 */
export function isHTMLElement(x: unknown): x is HTMLElement {
  return isDOMNode(x) && x.nodeType === DOM_ELEMENT_TYPE;
}

/**
 * @param x - The element being tested
 * @returns Returns true if x is a DOM Node, false otherwise.
 */
export function isDOMNode(x: unknown): x is Node {
  return (
    typeof x === 'object' &&
    x !== null &&
    'nodeType' in x &&
    typeof x.nodeType === 'number'
  );
}

/**
 * @param x - The element being testing
 * @returns Returns true if x is a document fragment, false otherwise.
 */
export function isDocumentFragment(x: unknown): x is DocumentFragment {
  return isDOMNode(x) && x.nodeType === DOM_DOCUMENT_FRAGMENT_TYPE;
}

/**
 * @experimental
 *
 * Read the editor's `$getDOMSlot` configuration (defaulting to the base
 * implementation when no override is registered via {@link DOMRenderExtension}).
 * Cross-package consumers (`@lexical/utils`, `@lexical/react`) use this to
 * route selection / DOM lookups through extension-configured slots.
 */
export function $getEditorDOMRenderConfig(
  editor: LexicalEditor = $getEditor()
): EditorDOMRenderConfig {
  return getEditorDOMRenderConfig(editor);
}

/**
 * @experimental
 *
 * Resolve the DOM slot for a node through the configured `$getDOMSlot` hook,
 * narrowing the return type via {@link DOMSlotForNode}: for an `ElementNode`
 * the result is an {@link ElementDOMSlot} (with children-management methods),
 * for non-Element nodes the base {@link DOMSlot} pointing at the keyed DOM.
 *
 * Invariants if an extension override returns a slot that doesn't match the
 * expected narrow type for the node (extension contract violation).
 */
export function $getDOMSlot<N extends LexicalNode>(
  node: N,
  dom: HTMLElement,
  editor?: LexicalEditor
): DOMSlotForNode<N>;
export function $getDOMSlot(
  node: LexicalNode,
  dom: HTMLElement,
  editor: LexicalEditor = $getEditor()
): DOMSlot<HTMLElement> {
  const slot = $getEditorDOMRenderConfig(editor).$getDOMSlot(node, dom, editor);
  if ($isElementNode(node)) {
    invariant(
      $isElementDOMSlot(slot),
      '$getDOMSlot: expected ElementDOMSlot for ElementNode (key %s type %s)',
      node.getKey(),
      node.getType()
    );
  }
  return slot;
}

/**
 * @experimental
 *
 * Type guard narrowing a {@link DOMSlot} to an {@link ElementDOMSlot}, which
 * exposes children-management methods like `insertChild` and the managed
 * line-break helpers.
 */
export function $isElementDOMSlot(
  slot: DOMSlot<HTMLElement>
): slot is ElementDOMSlot<HTMLElement> {
  return slot instanceof ElementDOMSlot;
}

/**
 * @experimental
 *
 * Resolve the actual text DOM (`Text`) for a `TextNode` through the
 * configured `$getDOMSlot` hook. Unlike the plain {@link getDOMTextNode}
 * which descends the first child chain from a raw element, this routes
 * through the slot so an extension wrapping the text node's keyed DOM
 * (e.g. one that injects a `contentEditable=false` sibling before the
 * text) still points at the correct content element.
 */
export function $getDOMTextNode(
  node: TextNode,
  dom: HTMLElement,
  editor: LexicalEditor = $getEditor()
): Text | null {
  const slot = $getDOMSlot(node, dom, editor);
  return getDOMTextNode(slot.element);
}

/**
 * True if this DOM node was marked with {@link setDOMUnmanaged}.
 *
 * @experimental
 */
export function isDOMUnmanaged(elementDom: Node & LexicalPrivateDOM): boolean {
  return elementDom.__lexicalUnmanaged === true;
}

/**
 * Starts with a node and moves up the tree (toward the root node) to find a matching node based on
 * the search parameters of the findFn. (Consider JavaScripts' .find() function where a testing function must be
 * passed as an argument. eg. if( (node) => node.__type === 'div') ) return true; otherwise return false
 * @param startingNode - The node where the search starts.
 * @param findFn - A testing function that returns true if the current node satisfies the testing parameters.
 * @returns `startingNode` or one of its ancestors that matches the `findFn` predicate and is not the `RootNode`, or `null` if no match was found.
 */
export const $findMatchingParent: {
  <T extends LexicalNode>(
    startingNode: LexicalNode,
    findFn: (node: LexicalNode) => node is T
  ): T | null;
  (
    startingNode: LexicalNode,
    findFn: (node: LexicalNode) => boolean
  ): LexicalNode | null;
} = (
  startingNode: LexicalNode,
  findFn: (node: LexicalNode) => boolean
): LexicalNode | null => {
  let curr: ElementNode | LexicalNode | null = startingNode;

  while (curr != null && !$isRootNode(curr)) {
    if (findFn(curr)) {
      return curr;
    }

    curr = curr.getParent();
  }

  return null;
};

export function $createChildrenArray(
  element: ElementNode,
  nodeMap: null | NodeMap
): Array<NodeKey> {
  const children = [];
  let nodeKey = element.__first;
  while (nodeKey !== null) {
    const node =
      nodeMap === null ? $getNodeByKey(nodeKey) : nodeMap.get(nodeKey);
    if (node === null || node === undefined) {
      invariant(false, '$createChildrenArray: node does not exist in nodeMap');
    }
    children.push(nodeKey);
    nodeKey = node.__next;
  }
  return children;
}

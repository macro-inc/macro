/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * MIT licensed; see ../../LICENSE. Retargeted from lexical@0.45.0.
 */
import type { ElementNode, LexicalEditor, TextNode } from 'lexical';
import { IS_ALL_FORMATTING } from './constants';
import { CAN_USE_BEFORE_INPUT, IS_FIREFOX } from './environment';
import { eventsState } from './events-state';
import {
  $handleBeforeInput,
  $handleCompositionEnd,
  $handleCompositionStart,
  $handleInput,
  onCompositionEnd,
  onCompositionStart,
  onInput,
  onKeyDown,
} from './input-events';
import { $handleKeyDown } from './root-events';
import {
  $getPreviousSelection,
  $getRoot,
  $getSelection,
  $isBlockElementNode,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isRootNode,
  $isTabNode,
  $isTextNode,
  $setSelection,
  BEFORE_INPUT_COMMAND,
  CLICK_COMMAND,
  COMMAND_PRIORITY_EDITOR,
  COMPOSITION_END_COMMAND,
  COMPOSITION_START_COMMAND,
  dispatchCommand,
  getActiveEditor,
  INPUT_COMMAND,
  KEY_DOWN_COMMAND,
  type RangeSelection,
  SELECTION_CHANGE_COMMAND,
  updateEditorSync,
} from './runtime';
import { $internalCreateRangeSelection } from './selection';
import { invariant } from './support';
import {
  $findMatchingParent,
  $getDOMTextNode,
  $isSelectionCapturedInDecorator,
  $isTokenOrSegmented,
  $isTokenOrTab,
  $shouldInsertTextAfterOrBeforeTextNode,
  doesContainSurrogatePair,
  getDOMSelection,
  getWindow,
  isDOMNode,
  isDOMTextNode,
  isFirefoxClipboardEvents,
  isHTMLElement,
  isSelectionWithinEditor,
} from './utils';

export type RootElementRemoveHandles = Array<() => void>;

export type RootElementEvents = Array<
  [
    string,
    Record<string, unknown> | ((event: Event, editor: LexicalEditor) => void),
  ]
>;

export const PASS_THROUGH_COMMAND = Object.freeze({});

export const ANDROID_COMPOSITION_LATENCY = 30;

export const rootElementEvents: RootElementEvents = [
  ['keydown', onKeyDown],
  ['pointerdown', onPointerDown],
  ['compositionstart', onCompositionStart],
  ['compositionend', onCompositionEnd],
  ['input', onInput],
  ['click', onClick],
  ['cut', PASS_THROUGH_COMMAND],
  ['copy', PASS_THROUGH_COMMAND],
  ['dragstart', PASS_THROUGH_COMMAND],
  ['dragover', PASS_THROUGH_COMMAND],
  ['dragend', PASS_THROUGH_COMMAND],
  ['paste', PASS_THROUGH_COMMAND],
  ['focus', PASS_THROUGH_COMMAND],
  ['blur', PASS_THROUGH_COMMAND],
  ['drop', PASS_THROUGH_COMMAND],
];

if (CAN_USE_BEFORE_INPUT) {
  rootElementEvents.push([
    'beforeinput',
    (event, editor) => onBeforeInput(event as InputEvent, editor),
  ]);
}

// Node can be moved between documents (for example using createPortal), so we
// need to track the document each root element was originally registered on.
export const rootElementToDocument = new WeakMap<HTMLElement, Document>();

export const rootElementsRegistered = new WeakMap<Document, number>();

// This export function is used to determine if Lexical should attempt to override
// the default browser behavior for insertion of text and use its own internal
// heuristics. This is an extremely important function, and makes much of Lexical
// work as intended between different browsers and across word, line and character
// boundary/formats. It also is important for text replacement, node schemas and
// composition mechanics.
export function $shouldPreventDefaultAndInsertText(
  selection: RangeSelection,
  domTargetRange: null | StaticRange,
  text: string,
  timeStamp: number,
  isBeforeInput: boolean
): boolean {
  const anchor = selection.anchor;
  const focus = selection.focus;
  const anchorNode = anchor.getNode();
  const editor = getActiveEditor();
  const domSelection = getDOMSelection(getWindow(editor));
  const domAnchorNode = domSelection !== null ? domSelection.anchorNode : null;
  const anchorKey = anchor.key;
  const backingAnchorElement = editor.getElementByKey(anchorKey);
  const textLength = text.length;

  return (
    anchorKey !== focus.key ||
    // If we're working with a non-text node.
    !$isTextNode(anchorNode) ||
    // If we are replacing a range with a single character or grapheme, and not composing.
    (((!isBeforeInput &&
      (!CAN_USE_BEFORE_INPUT ||
        // We check to see if there has been
        // a recent beforeinput event for "textInput". If there has been one in the last
        // 50ms then we proceed as normal. However, if there is not, then this is likely
        // a dangling `input` event caused by execCommand('insertText').
        eventsState.lastBeforeInputInsertTextTimeStamp < timeStamp + 50)) ||
      (anchorNode.isDirty() && textLength < 2) ||
      // TODO consider if there are other scenarios when multiple code units
      //      should be addressed here
      doesContainSurrogatePair(text)) &&
      anchor.offset !== focus.offset &&
      !anchorNode.isComposing()) ||
    // Any non standard text node.
    $isTokenOrSegmented(anchorNode) ||
    // If the text length is more than a single character and we're either
    // dealing with this in "beforeinput" or where the node has already recently
    // been changed (thus is dirty).
    (anchorNode.isDirty() && textLength > 1) ||
    // If the DOM selection element is not the same as the backing node during beforeinput.
    ((isBeforeInput || !CAN_USE_BEFORE_INPUT) &&
      backingAnchorElement !== null &&
      !anchorNode.isComposing() &&
      domAnchorNode !==
        $getDOMTextNode(anchorNode, backingAnchorElement, editor)) ||
    // If TargetRange is not the same as the DOM selection; browser trying to edit random parts
    // of the editor.
    (domSelection !== null &&
      domTargetRange !== null &&
      (!domTargetRange.collapsed ||
        domTargetRange.startContainer !== domSelection.anchorNode ||
        domTargetRange.startOffset !== domSelection.anchorOffset)) ||
    // Check if we're changing from bold to italics, or some other format.
    (!anchorNode.isComposing() &&
      (anchorNode.getFormat() !== selection.format ||
        anchorNode.getStyle() !== selection.style)) ||
    // One last set of heuristics to check against.
    $shouldInsertTextAfterOrBeforeTextNode(selection, anchorNode)
  );
}

export function shouldSkipSelectionChange(
  domNode: null | Node,
  offset: number
): boolean {
  return (
    isDOMTextNode(domNode) &&
    domNode.nodeValue !== null &&
    offset !== 0 &&
    offset !== domNode.nodeValue.length
  );
}

export function onSelectionChange(
  domSelection: Selection,
  editor: LexicalEditor,
  isActive: boolean
): void {
  const {
    anchorNode: anchorDOM,
    anchorOffset,
    focusNode: focusDOM,
    focusOffset,
  } = domSelection;
  if (eventsState.isSelectionChangeFromDOMUpdate) {
    eventsState.isSelectionChangeFromDOMUpdate = false;

    // If native DOM selection is on a DOM element, then
    // we should continue as usual, as Lexical's selection
    // may have normalized to a better child. If the DOM
    // element is a text node, we can safely apply this
    // optimization and skip the selection change entirely.
    // We also need to check if the offset is at the boundary,
    // because in this case, we might need to normalize to a
    // sibling instead.
    if (
      shouldSkipSelectionChange(anchorDOM, anchorOffset) &&
      shouldSkipSelectionChange(focusDOM, focusOffset) &&
      !eventsState.postDeleteSelectionToRestore
    ) {
      return;
    }
  }
  updateEditorSync(editor, () => {
    // Non-active editor don't need any extra logic for selection, it only needs update
    // to reconcile selection (set it to null) to ensure that only one editor has non-null selection.
    if (!isActive) {
      $setSelection(null);
      return;
    }

    if (!isSelectionWithinEditor(editor, anchorDOM, focusDOM)) {
      return;
    }

    let selection = $getSelection();

    // Restore selection in the event of incorrect rightward shift after deletion
    if (
      eventsState.postDeleteSelectionToRestore &&
      $isRangeSelection(selection) &&
      selection.isCollapsed()
    ) {
      const curAnchor = selection.anchor;
      const prevAnchor = eventsState.postDeleteSelectionToRestore.anchor;
      if (
        // Rightward shift in same node
        (curAnchor.key === prevAnchor.key &&
          curAnchor.offset === prevAnchor.offset + 1) ||
        // Or rightward shift into sibling node
        (curAnchor.offset === 1 &&
          prevAnchor.getNode().is(curAnchor.getNode().getPreviousSibling()))
      ) {
        // Restore selection
        selection = eventsState.postDeleteSelectionToRestore.clone();
        $setSelection(selection);
      }
    }
    eventsState.postDeleteSelectionToRestore = null;

    // Update the selection format
    if ($isRangeSelection(selection)) {
      const anchor = selection.anchor;
      const anchorNode = anchor.getNode();

      if (selection.isCollapsed()) {
        // Badly interpreted range selection when collapsed - #1482
        if (
          domSelection.type === 'Range' &&
          domSelection.anchorNode === domSelection.focusNode
        ) {
          selection.dirty = true;
        }

        // If we have marked a collapsed selection format, and we're
        // within the given time range – then attempt to use that format
        // instead of getting the format from the anchor node.
        const windowEvent = getWindow(editor).event;
        const currentTimeStamp = windowEvent
          ? windowEvent.timeStamp
          : performance.now();
        const [lastFormat, lastStyle, lastOffset, lastKey, timeStamp] =
          eventsState.collapsedSelectionFormat;

        const root = $getRoot();
        const isRootTextContentEmpty =
          editor.isComposing() === false && root.getTextContent() === '';

        if (
          currentTimeStamp < timeStamp + 200 &&
          anchor.offset === lastOffset &&
          anchor.key === lastKey
        ) {
          $updateSelectionFormatStyle(selection, lastFormat, lastStyle);
        } else {
          if (anchor.type === 'text') {
            invariant(
              $isTextNode(anchorNode),
              'Point.getNode() must return TextNode when type is text'
            );
            $updateSelectionFormatStyleFromTextNode(selection, anchorNode);
          } else if (anchor.type === 'element' && !isRootTextContentEmpty) {
            invariant(
              $isElementNode(anchorNode),
              'Point.getNode() must return ElementNode when type is element'
            );
            const lastNode = anchor.getNode();
            if (
              // This previously applied to all ParagraphNode
              lastNode.isEmpty()
            ) {
              $updateSelectionFormatStyleFromElementNode(selection, lastNode);
            } else {
              $updateSelectionFormatStyle(selection, selection.format, '');
            }
          }
        }
      } else {
        const anchorKey = anchor.key;
        const focus = selection.focus;
        const focusKey = focus.key;
        const nodes = selection.getNodes();
        const nodesLength = nodes.length;
        const isBackward = selection.isBackward();
        const startOffset = isBackward ? focusOffset : anchorOffset;
        const endOffset = isBackward ? anchorOffset : focusOffset;
        const startKey = isBackward ? focusKey : anchorKey;
        const endKey = isBackward ? anchorKey : focusKey;
        let combinedFormat = IS_ALL_FORMATTING;
        let hasTextNodes = false;
        for (let i = 0; i < nodesLength; i++) {
          const node = nodes[i];
          const textContentSize = node.getTextContentSize();
          if (
            $isTextNode(node) &&
            textContentSize !== 0 &&
            // Exclude empty text nodes at boundaries resulting from user's selection
            !(
              (i === 0 &&
                node.__key === startKey &&
                startOffset === textContentSize) ||
              (i === nodesLength - 1 &&
                node.__key === endKey &&
                endOffset === 0)
            )
          ) {
            // TODO: what about style?
            hasTextNodes = true;
            combinedFormat &= node.getFormat();
            if (combinedFormat === 0) {
              break;
            }
          }
        }

        selection.format = hasTextNodes ? combinedFormat : 0;
      }
    }

    dispatchCommand(editor, SELECTION_CHANGE_COMMAND, undefined);
  });
}

export function $updateSelectionFormatStyle(
  selection: RangeSelection,
  format: number,
  style: string
) {
  if (selection.format !== format || selection.style !== style) {
    selection.format = format;
    selection.style = style;
    selection.dirty = true;
  }
}

export function $updateSelectionFormatStyleFromTextNode(
  selection: RangeSelection,
  node: TextNode
) {
  const format = node.getFormat();
  const style = node.getStyle();
  $updateSelectionFormatStyle(selection, format, style);
}

export function $updateSelectionFormatStyleFromElementNode(
  selection: RangeSelection,
  node: ElementNode
) {
  const format = node.getTextFormat();
  const style = node.getTextStyle();
  $updateSelectionFormatStyle(selection, format, style);
}

// This is a work-around is mainly Chrome specific bug where if you select
// the contents of an empty block, you cannot easily unselect anything.
// This results in a tiny selection box that looks buggy/broken. This can
// also help other browsers when selection might "appear" lost, when it
// really isn't.
export function onClick(event: PointerEvent, editor: LexicalEditor): void {
  updateEditorSync(editor, () => {
    const selection = $getSelection();
    const domSelection = getDOMSelection(getWindow(editor));
    const lastSelection = $getPreviousSelection();

    if (domSelection) {
      if ($isRangeSelection(selection)) {
        const anchor = selection.anchor;
        const anchorNode = anchor.getNode();

        if (
          anchor.type === 'element' &&
          anchor.offset === 0 &&
          selection.isCollapsed() &&
          !$isRootNode(anchorNode) &&
          $getRoot().getChildrenSize() === 1 &&
          anchorNode.getTopLevelElementOrThrow().isEmpty() &&
          lastSelection !== null &&
          selection.is(lastSelection)
        ) {
          domSelection.removeAllRanges();
          selection.dirty = true;
        }
      } else if (event.pointerType === 'touch' || event.pointerType === 'pen') {
        // This is used to update the selection on touch devices (including Apple Pencil) when the user clicks on text after a
        // node selection. See isSelectionChangeFromMouseDown for the inverse
        const domAnchorNode = domSelection.anchorNode;
        // If the user is attempting to click selection back onto text, then
        // we should attempt create a range selection.
        // When we click on an empty paragraph node or the end of a paragraph that ends
        // with an image/poll, the nodeType will be ELEMENT_NODE
        if (isHTMLElement(domAnchorNode) || isDOMTextNode(domAnchorNode)) {
          const newSelection = $internalCreateRangeSelection(
            lastSelection,
            domSelection,
            editor,
            event
          );
          $setSelection(newSelection);
        }
      }
    }

    dispatchCommand(editor, CLICK_COMMAND, event);
  });
}

export function onPointerDown(event: PointerEvent, editor: LexicalEditor) {
  // TODO implement text drag & drop
  const target = event.target;
  const pointerType = event.pointerType;
  if (
    isDOMNode(target) &&
    pointerType !== 'touch' &&
    pointerType !== 'pen' &&
    event.button === 0
  ) {
    updateEditorSync(editor, () => {
      // Drag & drop should not recompute selection until mouse up; otherwise the initially
      // selected content is lost.
      if (!$isSelectionCapturedInDecorator(target)) {
        eventsState.isSelectionChangeFromMouseDown = true;
      }
    });
  }
}

export function getTargetRange(event: InputEvent): null | StaticRange {
  if (!event.getTargetRanges) {
    return null;
  }
  const targetRanges = event.getTargetRanges();
  if (targetRanges.length === 0) {
    return null;
  }
  return targetRanges[0];
}

// When a macOS text replacement is accepted, Chrome and Firefox fire input events for the key press that
// triggered the acceptance *before* the one for the replacement text. This causes the caret to be placed
// before the acceptance boundary. This export function moves the caret past the acceptance boundary.
export function $maybeMoveSelectionPastTrailingAcceptanceBoundary(
  insertedText: string | null | undefined
): void {
  if (
    insertedText == null ||
    insertedText.length <= 1 ||
    eventsState.lastKeyCode == null
  ) {
    return;
  }

  const characterToSearchFor =
    eventsState.lastKeyCode.length === 1
      ? eventsState.lastKeyCode
      : eventsState.lastKeyCode === 'Enter'
        ? '\n'
        : eventsState.lastKeyCode === 'Tab'
          ? '\t'
          : null;

  if (!characterToSearchFor) {
    return;
  }

  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return;
  }

  const anchorNode = selection.anchor.getNode();
  if (!$isTextNode(anchorNode)) {
    return;
  }

  const { offset } = selection.anchor;
  if (anchorNode.getTextContentSize() === offset) {
    const nextSibling = anchorNode.getNextSibling();
    if (characterToSearchFor === '\n') {
      if ($isLineBreakNode(nextSibling)) {
        nextSibling.selectEnd();
      } else if (!nextSibling) {
        const block = $findMatchingParent(anchorNode, $isBlockElementNode);
        const nextBlock = block && block.getNextSibling();
        if ($isElementNode(nextBlock)) {
          nextBlock.selectStart();
        }
      }
    } else if (characterToSearchFor === '\t') {
      if ($isTabNode(nextSibling)) {
        nextSibling.selectEnd();
      }
    } else if (
      $isTextNode(nextSibling) &&
      nextSibling.getTextContent()[0] === characterToSearchFor
    ) {
      nextSibling.select(1, 1);
    }
  } else if (anchorNode.getTextContent()[offset] === characterToSearchFor) {
    anchorNode.select(offset + 1, offset + 1);
  }
}

export function $canRemoveText(
  anchorNode: TextNode | ElementNode,
  focusNode: TextNode | ElementNode
): boolean {
  return (
    anchorNode !== focusNode ||
    $isElementNode(anchorNode) ||
    $isElementNode(focusNode) ||
    !$isTokenOrTab(anchorNode) ||
    !$isTokenOrTab(focusNode)
  );
}

export function isPossiblyAndroidKeyPress(timeStamp: number): boolean {
  return (
    eventsState.lastKeyCode === 'MediaLast' &&
    timeStamp < eventsState.lastKeyDownTimeStamp + ANDROID_COMPOSITION_LATENCY
  );
}

export function clearHandledSelectionCommandInsertText(): void {
  eventsState.isInsertTextAfterHandledSelectionCommand = false;
  if (eventsState.handledSelectionCommandTimeoutId !== null) {
    clearTimeout(eventsState.handledSelectionCommandTimeoutId);
    eventsState.handledSelectionCommandTimeoutId = null;
  }
}

export function markHandledSelectionCommandInsertText(): void {
  clearHandledSelectionCommandInsertText();
  eventsState.isInsertTextAfterHandledSelectionCommand = true;
  eventsState.handledSelectionCommandTimeoutId = setTimeout(
    clearHandledSelectionCommandInsertText,
    0
  );
}

export function registerDefaultCommandHandlers(
  editor: LexicalEditor
): () => void {
  const remove = [
    editor.registerCommand(
      BEFORE_INPUT_COMMAND,
      $handleBeforeInput,
      COMMAND_PRIORITY_EDITOR
    ),
    editor.registerCommand(
      INPUT_COMMAND,
      $handleInput,
      COMMAND_PRIORITY_EDITOR
    ),
    editor.registerCommand(
      COMPOSITION_START_COMMAND,
      $handleCompositionStart,
      COMMAND_PRIORITY_EDITOR
    ),
    editor.registerCommand(
      COMPOSITION_END_COMMAND,
      $handleCompositionEnd,
      COMMAND_PRIORITY_EDITOR
    ),
    editor.registerCommand(
      KEY_DOWN_COMMAND,
      $handleKeyDown,
      COMMAND_PRIORITY_EDITOR
    ),
  ];
  return () => {
    for (const dispose of remove) dispose();
  };
}

export function onBeforeInput(event: InputEvent, editor: LexicalEditor): void {
  const inputType = event.inputType;

  // We let the browser do its own thing for composition.
  if (
    inputType === 'deleteCompositionText' ||
    // If we're pasting in FF, we shouldn't get this event
    // as the `paste` event should have triggered, unless the
    // user has dom.event.clipboardevents.enabled disabled in
    // about:config. In that case, we need to process the
    // pasted content in the DOM mutation phase.
    (IS_FIREFOX && isFirefoxClipboardEvents(editor))
  ) {
    return;
  } else if (inputType === 'insertCompositionText') {
    return;
  }

  dispatchCommand(editor, BEFORE_INPUT_COMMAND, event);
}
export {
  $handleBeforeInput,
  $handleCompositionEnd,
  $handleCompositionStart,
  $handleInput,
  $onCompositionEndImpl,
  onCompositionEnd,
  onCompositionStart,
  onInput,
  onKeyDown,
} from './input-events';
export {
  $handleKeyDown,
  activeNestedEditorsMap,
  addRootElementEvents,
  cleanActiveNestedEditorsMap,
  type EventHandler,
  getRootElementRemoveHandles,
  hasStoppedLexicalPropagation,
  markCollapsedSelectionFormat,
  markSelectionChangeFromDOMUpdate,
  onDocumentSelectionChange,
  removeRootElementEvents,
  rootElementNotRegisteredWarning,
  stopLexicalPropagation,
} from './root-events';

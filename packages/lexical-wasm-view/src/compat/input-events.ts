/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * MIT licensed; see ../../LICENSE. Retargeted from lexical@0.45.0.
 */

import { COMPOSITION_START_CHAR, DOUBLE_LINE_BREAK } from './constants';
import {
  CAN_USE_BEFORE_INPUT,
  IS_ANDROID_CHROME,
  IS_APPLE_WEBKIT,
  IS_FIREFOX,
  IS_IOS,
  IS_SAFARI,
} from './environment';
import {
  $canRemoveText,
  $maybeMoveSelectionPastTrailingAcceptanceBoundary,
  $shouldPreventDefaultAndInsertText,
  $updateSelectionFormatStyleFromTextNode,
  ANDROID_COMPOSITION_LATENCY,
  clearHandledSelectionCommandInsertText,
  getTargetRange,
  isPossiblyAndroidKeyPress,
} from './events';
import { eventsState } from './events-state';
import {
  $addUpdateTag,
  $getNodeByKey,
  $getPreviousSelection,
  $getSelection,
  $isDecoratorNode,
  $isNodeSelection,
  $isRangeSelection,
  $isRootNode,
  $isTextNode,
  $setCompositionKey,
  $setSelection,
  COMPOSITION_END_COMMAND,
  COMPOSITION_END_TAG,
  COMPOSITION_START_COMMAND,
  COMPOSITION_START_TAG,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  DELETE_CHARACTER_COMMAND,
  DELETE_LINE_COMMAND,
  DELETE_WORD_COMMAND,
  dispatchCommand,
  FORMAT_TEXT_COMMAND,
  getActiveEditor,
  INPUT_COMMAND,
  INSERT_LINE_BREAK_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
  REDO_COMMAND,
  REMOVE_TEXT_COMMAND,
  SKIP_SELECTION_FOCUS_TAG,
  UNDO_COMMAND,
  updateEditorSync,
} from './runtime';
import { invariant } from './support';
import type { CompatEditor as LexicalEditor } from './types';
import {
  $flushMutations,
  $getAdjacentNode,
  $getDOMTextNode,
  $isSelectionCapturedInDecorator,
  $updateSelectedTextFromDOM,
  $updateTextNodeFromDOMContent,
  getAnchorTextFromDOM,
  getDOMSelection,
  getWindow,
  isHTMLElement,
} from './utils';

export function $handleBeforeInput(event: InputEvent): boolean {
  const inputType = event.inputType;
  const targetRange = getTargetRange(event);
  const editor = getActiveEditor();

  const selection = $getSelection();

  // On Chrome on macOS, some handled selection commands may accept a pending text replacement. This behavior
  // is not desirable, so we check for this case and prevent bogus text replacements from happening.
  if (
    inputType === 'insertText' &&
    event.data &&
    eventsState.isInsertTextAfterHandledSelectionCommand
  ) {
    clearHandledSelectionCommandInsertText();
    event.preventDefault();
    if ($isRangeSelection(selection) && !selection.isCollapsed()) {
      const point = selection.isBackward() ? selection.anchor : selection.focus;
      selection.anchor.set(point.key, point.offset, point.type);
      selection.focus.set(point.key, point.offset, point.type);
    }
    return true;
  }

  if (inputType === 'deleteContentBackward') {
    if (selection === null) {
      // Use previous selection
      const prevSelection = $getPreviousSelection();

      if (!$isRangeSelection(prevSelection)) {
        return true;
      }

      $setSelection(prevSelection.clone());
    }

    if ($isRangeSelection(selection)) {
      const isSelectionAnchorSameAsFocus =
        selection.anchor.key === selection.focus.key;

      if (
        isPossiblyAndroidKeyPress(event.timeStamp) &&
        editor.isComposing() &&
        isSelectionAnchorSameAsFocus
      ) {
        $setCompositionKey(null);
        eventsState.lastKeyDownTimeStamp = 0;
        // Fixes an Android bug where selection flickers when backspacing
        setTimeout(() => {
          updateEditorSync(editor, () => {
            $setCompositionKey(null);
          });
        }, ANDROID_COMPOSITION_LATENCY);
        if ($isRangeSelection(selection)) {
          const anchorNode = selection.anchor.getNode();
          anchorNode.markDirty();
          invariant($isTextNode(anchorNode), 'Anchor node must be a TextNode');
          $updateSelectionFormatStyleFromTextNode(selection, anchorNode);
        }
      } else {
        $setCompositionKey(null);

        // iOS 10-key Korean IME (천지인/Chunjiin) does not fire compositionstart /
        // compositionend events. Instead it sends a deleteContentBackward with a
        // non-collapsed targetRange to delete the current composing jamo, immediately
        // followed by insertText with the updated syllable.
        //
        // Because editor.isComposing() is always false for this keyboard type, Lexical
        // would otherwise dispatch DELETE_CHARACTER_COMMAND, which ignores the
        // targetRange entirely and deletes only one character before the cursor. This
        // leaves orphaned jamo in the editor state that accumulate and corrupt output
        // (e.g. typing "안녕하세요" produces "안녕하ᄉ세ᄋᄋ요").
        //
        // Fix: when on iOS with a non-collapsed targetRange, apply the range directly
        // to the Lexical selection and delete the matched text. If applyDOMRange cannot
        // resolve the range (returns a collapsed selection), fall through to the default
        // Lexical deletion path.
        if (IS_IOS && targetRange !== null && !targetRange.collapsed) {
          selection.applyDOMRange(targetRange);
          if (!selection.isCollapsed()) {
            event.preventDefault();
            selection.removeText();
            return true;
          }
        }

        event.preventDefault();
        // Chromium Android at the moment seems to ignore the preventDefault
        // on 'deleteContentBackward' and still deletes the content. Which leads
        // to multiple deletions. So we let the browser handle the deletion in this case.
        const selectedNode = selection.anchor.getNode();
        const selectedNodeText = selectedNode.getTextContent();
        // When the target node has `canInsertTextAfter` set to false, the first deletion
        // doesn't have an effect, so we need to handle it with Lexical.
        const selectedNodeCanInsertTextAfter =
          selectedNode.canInsertTextAfter();
        const hasSelectedAllTextInNode =
          selection.anchor.offset === 0 &&
          selection.focus.offset === selectedNodeText.length;
        let shouldLetBrowserHandleDelete =
          IS_ANDROID_CHROME &&
          isSelectionAnchorSameAsFocus &&
          !hasSelectedAllTextInNode &&
          selectedNodeCanInsertTextAfter;
        // Check if selection is collapsed and if the previous node is a decorator node
        // If so, the browser will not be able to handle the deletion
        if (shouldLetBrowserHandleDelete && selection.isCollapsed()) {
          shouldLetBrowserHandleDelete = !$isDecoratorNode(
            $getAdjacentNode(selection.anchor, true)
          );
        }
        if (!shouldLetBrowserHandleDelete) {
          dispatchCommand(editor, DELETE_CHARACTER_COMMAND, true);
          // When deleting across paragraphs, Chrome on Android incorrectly shifts the selection rightwards
          // We save the correct selection to restore later during handling of selectionchange event
          const selectionAfterDelete = $getSelection();
          if (
            IS_ANDROID_CHROME &&
            $isRangeSelection(selectionAfterDelete) &&
            selectionAfterDelete.isCollapsed()
          ) {
            eventsState.postDeleteSelectionToRestore = selectionAfterDelete;
            // Cleanup in case selectionchange does not fire
            setTimeout(() => (eventsState.postDeleteSelectionToRestore = null));
          }
        }
      }
      return true;
    }
  }

  if (!$isRangeSelection(selection)) {
    return true;
  }

  const data = event.data;

  // This represents the case when two beforeinput events are triggered at the same time (without a
  // full event loop ending at input). This happens with MacOS with the default keyboard settings,
  // a combination of autocorrection + autocapitalization.
  // Having Lexical run everything in controlled mode would fix the issue without additional code
  // but this would kill the massive performance win from the most common typing event.
  // Alternatively, when this happens we can prematurely update our EditorState based on the DOM
  // content, a job that would usually be the input event's responsibility.
  if (eventsState.unprocessedBeforeInputData !== null) {
    $updateSelectedTextFromDOM(
      false,
      editor,
      eventsState.unprocessedBeforeInputData
    );
  }

  if (
    (!selection.dirty || eventsState.unprocessedBeforeInputData !== null) &&
    selection.isCollapsed() &&
    !$isRootNode(selection.anchor.getNode()) &&
    targetRange !== null
  ) {
    selection.applyDOMRange(targetRange);
  }

  eventsState.unprocessedBeforeInputData = null;

  const anchor = selection.anchor;
  const focus = selection.focus;
  const anchorNode = anchor.getNode();
  const focusNode = focus.getNode();

  if (inputType === 'insertText' || inputType === 'insertTranspose') {
    if (data === '\n') {
      event.preventDefault();
      dispatchCommand(editor, INSERT_LINE_BREAK_COMMAND, false);
    } else if (data === DOUBLE_LINE_BREAK) {
      event.preventDefault();
      dispatchCommand(editor, INSERT_PARAGRAPH_COMMAND, undefined);
    } else if (data == null && event.dataTransfer) {
      // Gets around a Safari text replacement bug.
      const text = event.dataTransfer.getData('text/plain');
      event.preventDefault();
      selection.insertRawText(text);
    } else if (
      data != null &&
      $shouldPreventDefaultAndInsertText(
        selection,
        targetRange,
        data,
        event.timeStamp,
        true
      )
    ) {
      event.preventDefault();
      dispatchCommand(editor, CONTROLLED_TEXT_INSERTION_COMMAND, data);
      $maybeMoveSelectionPastTrailingAcceptanceBoundary(data);
    } else {
      eventsState.unprocessedBeforeInputData = data;
    }
    eventsState.lastBeforeInputInsertTextTimeStamp = event.timeStamp;
    return true;
  }

  // Prevent the browser from carrying out
  // the input event, so we can control the
  // output.
  event.preventDefault();

  switch (inputType) {
    case 'insertFromYank':
    case 'insertFromDrop':
    case 'insertReplacementText': {
      dispatchCommand(editor, CONTROLLED_TEXT_INSERTION_COMMAND, event);
      const textFromDataTransfer = event.dataTransfer
        ? event.dataTransfer.getData('text/plain')
        : null;
      $maybeMoveSelectionPastTrailingAcceptanceBoundary(
        textFromDataTransfer ?? event.data
      );
      break;
    }

    case 'insertFromComposition': {
      // This is the end of composition
      $setCompositionKey(null);
      dispatchCommand(editor, CONTROLLED_TEXT_INSERTION_COMMAND, event);
      break;
    }

    case 'insertLineBreak': {
      // Used for Android
      $setCompositionKey(null);
      dispatchCommand(editor, INSERT_LINE_BREAK_COMMAND, false);
      break;
    }

    case 'insertParagraph': {
      // Used for Android
      $setCompositionKey(null);

      // Safari does not provide the type "insertLineBreak".
      // So instead, we need to infer it from the keyboard event.
      // We do not apply this logic to iOS to allow newline auto-capitalization
      // work without creating linebreaks when pressing Enter
      if (eventsState.isInsertLineBreak && !IS_IOS) {
        eventsState.isInsertLineBreak = false;
        dispatchCommand(editor, INSERT_LINE_BREAK_COMMAND, false);
      } else {
        dispatchCommand(editor, INSERT_PARAGRAPH_COMMAND, undefined);
      }

      break;
    }

    case 'insertFromPaste':
    case 'insertFromPasteAsQuotation': {
      dispatchCommand(editor, PASTE_COMMAND, event);
      break;
    }

    case 'deleteByComposition': {
      if ($canRemoveText(anchorNode, focusNode)) {
        dispatchCommand(editor, REMOVE_TEXT_COMMAND, event);
      }

      break;
    }

    case 'deleteByDrag': {
      // The drop target is taking over focus and the document selection;
      // suppress this editor's own attempt to focus its root or move the DOM
      // selection back to the post-removal point during reconciliation.
      $addUpdateTag(SKIP_SELECTION_FOCUS_TAG);
      dispatchCommand(editor, REMOVE_TEXT_COMMAND, event);
      break;
    }

    case 'deleteByCut': {
      dispatchCommand(editor, REMOVE_TEXT_COMMAND, event);
      break;
    }

    case 'deleteContent': {
      dispatchCommand(editor, DELETE_CHARACTER_COMMAND, false);
      break;
    }

    case 'deleteWordBackward': {
      dispatchCommand(editor, DELETE_WORD_COMMAND, true);
      break;
    }

    case 'deleteWordForward': {
      dispatchCommand(editor, DELETE_WORD_COMMAND, false);
      break;
    }

    case 'deleteHardLineBackward':
    case 'deleteSoftLineBackward': {
      dispatchCommand(editor, DELETE_LINE_COMMAND, true);
      break;
    }

    case 'deleteContentForward':
    case 'deleteHardLineForward':
    case 'deleteSoftLineForward': {
      dispatchCommand(editor, DELETE_LINE_COMMAND, false);
      break;
    }

    case 'formatStrikeThrough': {
      dispatchCommand(editor, FORMAT_TEXT_COMMAND, 'strikethrough');
      break;
    }

    case 'formatBold': {
      dispatchCommand(editor, FORMAT_TEXT_COMMAND, 'bold');
      break;
    }

    case 'formatItalic': {
      dispatchCommand(editor, FORMAT_TEXT_COMMAND, 'italic');
      break;
    }

    case 'formatUnderline': {
      dispatchCommand(editor, FORMAT_TEXT_COMMAND, 'underline');
      break;
    }

    case 'historyUndo': {
      dispatchCommand(editor, UNDO_COMMAND, undefined);
      break;
    }

    case 'historyRedo': {
      dispatchCommand(editor, REDO_COMMAND, undefined);
      break;
    }

    default:
    // NO-OP
  }

  return true;
}

export function onInput(event: InputEvent, editor: LexicalEditor): void {
  // Note that the MutationObserver may or may not have already fired,
  // but the the DOM and selection may have already changed.
  // See also:
  // - https://github.com/facebook/lexical/issues/7028
  // - https://github.com/facebook/lexical/pull/794

  // We don't want the onInput to bubble, in the case of nested editors.
  event.stopPropagation();
  clearHandledSelectionCommandInsertText();
  updateEditorSync(
    editor,
    () => {
      editor.dispatchCommand(INPUT_COMMAND, event);
    },
    { event }
  );
  eventsState.unprocessedBeforeInputData = null;
}

export function $handleInput(event: InputEvent): boolean {
  if (
    isHTMLElement(event.target) &&
    $isSelectionCapturedInDecorator(event.target)
  ) {
    return true;
  }

  const editor = getActiveEditor();
  const selection = $getSelection();
  const data = event.data;
  const targetRange = getTargetRange(event);

  if (
    data != null &&
    $isRangeSelection(selection) &&
    $shouldPreventDefaultAndInsertText(
      selection,
      targetRange,
      data,
      event.timeStamp,
      false
    )
  ) {
    // Given we're over-riding the default behavior, we will need
    // to ensure to disable composition before dispatching the
    // insertText command for when changing the sequence for FF.
    if (eventsState.isFirefoxEndingComposition) {
      $onCompositionEndImpl(editor, data);
      eventsState.isFirefoxEndingComposition = false;
    }
    const anchor = selection.anchor;
    const anchorNode = anchor.getNode();
    const domSelection = getDOMSelection(getWindow(editor));
    if (domSelection === null) {
      return true;
    }
    const isBackward = selection.isBackward();
    const startOffset = isBackward
      ? selection.anchor.offset
      : selection.focus.offset;
    const endOffset = isBackward
      ? selection.focus.offset
      : selection.anchor.offset;
    // If the content is the same as inserted, then don't dispatch an insertion.
    // Given onInput doesn't take the current selection (it uses the previous)
    // we can compare that against what the DOM currently says.
    if (
      !CAN_USE_BEFORE_INPUT ||
      selection.isCollapsed() ||
      !$isTextNode(anchorNode) ||
      domSelection.anchorNode === null ||
      anchorNode.getTextContent().slice(0, startOffset) +
        data +
        anchorNode.getTextContent().slice(startOffset + endOffset) !==
        getAnchorTextFromDOM(domSelection.anchorNode)
    ) {
      dispatchCommand(editor, CONTROLLED_TEXT_INSERTION_COMMAND, data);
    }

    const textLength = data.length;

    // Another hack for FF, as it's possible that the IME is still
    // open, even though compositionend has already fired (sigh).
    if (
      IS_FIREFOX &&
      textLength > 1 &&
      event.inputType === 'insertCompositionText' &&
      !editor.isComposing()
    ) {
      selection.anchor.offset -= textLength;
      selection._cachedNodes = null;
      selection._cachedIsBackward = null;
    }

    // This ensures consistency on Android.
    if (IS_ANDROID_CHROME && editor.isComposing()) {
      eventsState.lastKeyDownTimeStamp = 0;
      $setCompositionKey(null);
    }
  } else {
    const characterData = data !== null ? data : undefined;
    $updateSelectedTextFromDOM(false, editor, characterData);

    // onInput always fires after onCompositionEnd for FF.
    if (eventsState.isFirefoxEndingComposition) {
      $onCompositionEndImpl(editor, data || undefined);
      eventsState.isFirefoxEndingComposition = false;
    }
  }

  // Also flush any other mutations that might have occurred
  // since the change.
  $flushMutations();

  return true;
}

export function onCompositionStart(
  event: CompositionEvent,
  editor: LexicalEditor
): void {
  dispatchCommand(editor, COMPOSITION_START_COMMAND, event);
}

export function $handleCompositionStart(event: CompositionEvent): boolean {
  const editor = getActiveEditor();
  const selection = $getSelection();

  if ($isRangeSelection(selection) && !editor.isComposing()) {
    const anchor = selection.anchor;
    const node = selection.anchor.getNode();
    $setCompositionKey(anchor.key);
    $addUpdateTag(COMPOSITION_START_TAG);

    if (
      // If it has been 30ms since the last keydown, then we should
      // apply the empty space heuristic. We can't do this for Safari,
      // as the keydown fires after composition start.
      event.timeStamp <
        eventsState.lastKeyDownTimeStamp + ANDROID_COMPOSITION_LATENCY ||
      // FF has issues around composing multibyte characters, so we also
      // need to invoke the empty space heuristic below.
      anchor.type === 'element' ||
      !selection.isCollapsed() ||
      node.getFormat() !== selection.format ||
      ($isTextNode(node) && node.getStyle() !== selection.style)
    ) {
      // We insert a zero width character, ready for the composition
      // to get inserted into the new node we create. If
      // we don't do this, Safari will fail on us because
      // there is no text node matching the selection.
      dispatchCommand(
        editor,
        CONTROLLED_TEXT_INSERTION_COMMAND,
        COMPOSITION_START_CHAR
      );
    }
  }

  return true;
}

export function $handleCompositionEnd(event: CompositionEvent): boolean {
  const editor = getActiveEditor();
  $onCompositionEndImpl(editor, event.data);
  $addUpdateTag(COMPOSITION_END_TAG);
  return true;
}

export function $onCompositionEndImpl(
  editor: LexicalEditor,
  data?: string
): void {
  const compositionKey = editor._compositionKey;
  $setCompositionKey(null);

  // Handle termination of composition.
  if (compositionKey !== null && data != null) {
    // Composition can sometimes move to an adjacent DOM node when backspacing.
    // So check for the empty case.
    if (data === '') {
      const node = $getNodeByKey(compositionKey);
      const domElement = editor.getElementByKey(compositionKey);
      const textNode =
        domElement !== null && $isTextNode(node)
          ? $getDOMTextNode(node, domElement, editor)
          : null;

      if (
        textNode !== null &&
        textNode.nodeValue !== null &&
        $isTextNode(node)
      ) {
        const domSelection = getDOMSelection(getWindow(editor));
        let anchorOffset = null;
        let focusOffset = null;

        if (domSelection !== null && domSelection.anchorNode === textNode) {
          anchorOffset = domSelection.anchorOffset;
          focusOffset = domSelection.focusOffset;
        }

        $updateTextNodeFromDOMContent(
          node,
          textNode.nodeValue,
          anchorOffset,
          focusOffset,
          true
        );
      }
      return;
    } else if (data[data.length - 1] === '\n') {
      const selection = $getSelection();

      if ($isRangeSelection(selection) || $isNodeSelection(selection)) {
        // If the last character is a line break, we also need to insert
        // a line break.
        if ($isRangeSelection(selection)) {
          const focus = selection.focus;
          selection.anchor.set(focus.key, focus.offset, focus.type);
        }
        dispatchCommand(editor, KEY_ENTER_COMMAND, null);
        return;
      }
    }
  }

  $updateSelectedTextFromDOM(true, editor, data);
}

export function onCompositionEnd(
  event: CompositionEvent,
  editor: LexicalEditor
): void {
  // Firefox fires onCompositionEnd before onInput, but Chrome/Webkit,
  // fire onInput before onCompositionEnd. To ensure the sequence works
  // like Chrome/Webkit we use the isFirefoxEndingComposition flag to
  // defer handling of onCompositionEnd in Firefox till we have processed
  // the logic in onInput.
  if (IS_FIREFOX) {
    eventsState.isFirefoxEndingComposition = true;
  } else if (!IS_IOS && (IS_SAFARI || IS_APPLE_WEBKIT)) {
    // Fix：https://github.com/facebook/lexical/pull/7061
    // In safari, onCompositionEnd triggers before keydown
    // This will cause an extra character to be deleted when exiting the IME
    // Therefore, a flag is used to mark that the keydown event is triggered after onCompositionEnd
    // Ensure that an extra character is not deleted due to the backspace event being triggered in the keydown event.
    eventsState.isSafariEndingComposition = true;
    eventsState.safariEndCompositionEventData = event.data;
  } else {
    dispatchCommand(editor, COMPOSITION_END_COMMAND, event);
  }
}

export function onKeyDown(event: KeyboardEvent, editor: LexicalEditor): void {
  eventsState.lastKeyDownTimeStamp = event.timeStamp;
  eventsState.lastKeyCode = event.key;
  if (event.key !== 'Backspace') {
    clearHandledSelectionCommandInsertText();
  }
  if (editor.isComposing()) {
    return;
  }
  dispatchCommand(editor, KEY_DOWN_COMMAND, event);
}

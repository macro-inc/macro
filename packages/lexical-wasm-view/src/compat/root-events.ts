/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * MIT licensed; see ../../LICENSE. Retargeted from lexical@0.45.0.
 */
import type { NodeKey } from 'lexical';
import {
  markHandledSelectionCommandInsertText,
  onSelectionChange,
  type RootElementRemoveHandles,
  rootElementEvents,
  rootElementsRegistered,
  rootElementToDocument,
} from './events';
import { eventsState } from './events-state';
import { $onCompositionEndImpl } from './input-events';
import {
  $getPreviousSelection,
  $isRangeSelection,
  $setSelection,
  BLUR_COMMAND,
  COPY_COMMAND,
  CUT_COMMAND,
  DELETE_CHARACTER_COMMAND,
  DELETE_LINE_COMMAND,
  DELETE_WORD_COMMAND,
  DRAGEND_COMMAND,
  DRAGOVER_COMMAND,
  DRAGSTART_COMMAND,
  DROP_COMMAND,
  dispatchCommand,
  FOCUS_COMMAND,
  FORMAT_TEXT_COMMAND,
  getActiveEditor,
  INSERT_LINE_BREAK_COMMAND,
  isLexicalEditor,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_MODIFIER_COMMAND,
  KEY_SPACE_COMMAND,
  KEY_TAB_COMMAND,
  MOVE_TO_END,
  MOVE_TO_START,
  PASTE_COMMAND,
  REDO_COMMAND,
  SELECT_ALL_COMMAND,
  UNDO_COMMAND,
  updateEditorSync,
} from './runtime';
import { $internalCreateRangeSelection } from './selection';
import { invariant, warnOnlyOnce } from './support';
import type { CompatEditor as LexicalEditor } from './types';
import {
  getDOMSelectionFromTarget,
  getEditorPropertyFromDOMNode,
  getEditorsToPropagate,
  getNearestEditorFromDOMNode,
  isBackspace,
  isBold,
  isCopy,
  isCut,
  isDelete,
  isDeleteBackward,
  isDeleteForward,
  isDeleteLineBackward,
  isDeleteLineForward,
  isDeleteWordBackward,
  isDeleteWordForward,
  isDOMTextNode,
  isEscape,
  isHTMLElement,
  isItalic,
  isLineBreak,
  isModifier,
  isMoveBackward,
  isMoveDown,
  isMoveForward,
  isMoveToEnd,
  isMoveToStart,
  isMoveUp,
  isOpenLineBreak,
  isParagraph,
  isRedo,
  isSelectAll,
  isSpace,
  isTab,
  isUnderline,
  isUndo,
} from './utils';

export function $handleKeyDown(event: KeyboardEvent): boolean {
  const editor = getActiveEditor();
  if (event.key == null) {
    return true;
  }
  if (eventsState.isSafariEndingComposition) {
    if (isBackspace(event)) {
      updateEditorSync(editor, () => {
        $onCompositionEndImpl(
          editor,
          eventsState.safariEndCompositionEventData
        );
      });
      eventsState.isSafariEndingComposition = false;
      eventsState.safariEndCompositionEventData = '';
      return true;
    }
    eventsState.isSafariEndingComposition = false;
    eventsState.safariEndCompositionEventData = '';
  }

  if (isMoveForward(event)) {
    dispatchCommand(editor, KEY_ARROW_RIGHT_COMMAND, event);
  } else if (isMoveToEnd(event)) {
    dispatchCommand(editor, MOVE_TO_END, event);
  } else if (isMoveBackward(event)) {
    dispatchCommand(editor, KEY_ARROW_LEFT_COMMAND, event);
  } else if (isMoveToStart(event)) {
    dispatchCommand(editor, MOVE_TO_START, event);
  } else if (isMoveUp(event)) {
    dispatchCommand(editor, KEY_ARROW_UP_COMMAND, event);
  } else if (isMoveDown(event)) {
    dispatchCommand(editor, KEY_ARROW_DOWN_COMMAND, event);
  } else if (isLineBreak(event)) {
    eventsState.isInsertLineBreak = true;
    dispatchCommand(editor, KEY_ENTER_COMMAND, event);
  } else if (isSpace(event)) {
    dispatchCommand(editor, KEY_SPACE_COMMAND, event);
  } else if (isOpenLineBreak(event)) {
    event.preventDefault();
    eventsState.isInsertLineBreak = true;
    dispatchCommand(editor, INSERT_LINE_BREAK_COMMAND, true);
  } else if (isParagraph(event)) {
    eventsState.isInsertLineBreak = false;
    dispatchCommand(editor, KEY_ENTER_COMMAND, event);
  } else if (isDeleteBackward(event)) {
    if (isBackspace(event)) {
      if (dispatchCommand(editor, KEY_BACKSPACE_COMMAND, event)) {
        markHandledSelectionCommandInsertText();
      }
    } else {
      event.preventDefault();
      dispatchCommand(editor, DELETE_CHARACTER_COMMAND, true);
    }
  } else if (isEscape(event)) {
    dispatchCommand(editor, KEY_ESCAPE_COMMAND, event);
  } else if (isDeleteForward(event)) {
    if (isDelete(event)) {
      dispatchCommand(editor, KEY_DELETE_COMMAND, event);
    } else {
      event.preventDefault();
      dispatchCommand(editor, DELETE_CHARACTER_COMMAND, false);
    }
  } else if (isDeleteWordBackward(event)) {
    event.preventDefault();
    dispatchCommand(editor, DELETE_WORD_COMMAND, true);
  } else if (isDeleteWordForward(event)) {
    event.preventDefault();
    dispatchCommand(editor, DELETE_WORD_COMMAND, false);
  } else if (isDeleteLineBackward(event)) {
    event.preventDefault();
    dispatchCommand(editor, DELETE_LINE_COMMAND, true);
  } else if (isDeleteLineForward(event)) {
    event.preventDefault();
    dispatchCommand(editor, DELETE_LINE_COMMAND, false);
  } else if (isBold(event)) {
    event.preventDefault();
    dispatchCommand(editor, FORMAT_TEXT_COMMAND, 'bold');
  } else if (isUnderline(event)) {
    event.preventDefault();
    dispatchCommand(editor, FORMAT_TEXT_COMMAND, 'underline');
  } else if (isItalic(event)) {
    event.preventDefault();
    dispatchCommand(editor, FORMAT_TEXT_COMMAND, 'italic');
  } else if (isTab(event)) {
    dispatchCommand(editor, KEY_TAB_COMMAND, event);
  } else if (isUndo(event)) {
    event.preventDefault();
    dispatchCommand(editor, UNDO_COMMAND, undefined);
  } else if (isRedo(event)) {
    event.preventDefault();
    dispatchCommand(editor, REDO_COMMAND, undefined);
  } else {
    const prevSelection = editor._editorState._selection;
    if (isSelectAll(event)) {
      event.preventDefault();
      if (dispatchCommand(editor, SELECT_ALL_COMMAND, event)) {
        markHandledSelectionCommandInsertText();
      }
    } else if (prevSelection !== null && !$isRangeSelection(prevSelection)) {
      // Only RangeSelection can use the native cut/copy/select all
      if (isCopy(event)) {
        event.preventDefault();
        dispatchCommand(editor, COPY_COMMAND, event);
      } else if (isCut(event)) {
        event.preventDefault();
        dispatchCommand(editor, CUT_COMMAND, event);
      }
    }
  }

  if (isModifier(event)) {
    editor.dispatchCommand(KEY_MODIFIER_COMMAND, event);
  }

  return true;
}

export function getRootElementRemoveHandles(
  rootElement: HTMLElement
): RootElementRemoveHandles {
  // @ts-expect-error: internal field
  let eventHandles = rootElement.__lexicalEventHandles;

  if (eventHandles === undefined) {
    eventHandles = [];
    // @ts-expect-error: internal field
    rootElement.__lexicalEventHandles = eventHandles;
  }

  return eventHandles;
}

// Mapping root editors to their active nested editors, contains nested editors
// mapping only, so if root editor is selected map will have no reference to free up memory
export const activeNestedEditorsMap: Map<string, LexicalEditor> = new Map();

export function onDocumentSelectionChange(event: Event): void {
  const domSelection = getDOMSelectionFromTarget(event.target);
  if (domSelection === null) {
    return;
  }
  const nextActiveEditor = getNearestEditorFromDOMNode(domSelection.anchorNode);
  if (nextActiveEditor === null) {
    return;
  }

  if (eventsState.isSelectionChangeFromMouseDown) {
    eventsState.isSelectionChangeFromMouseDown = false;
    updateEditorSync(nextActiveEditor, () => {
      const lastSelection = $getPreviousSelection();
      const domAnchorNode = domSelection.anchorNode;
      if (isHTMLElement(domAnchorNode) || isDOMTextNode(domAnchorNode)) {
        // If the user is attempting to click selection back onto text, then
        // we should attempt create a range selection.
        // When we click on an empty paragraph node or the end of a paragraph that ends
        // with an image/poll, the nodeType will be ELEMENT_NODE
        const newSelection = $internalCreateRangeSelection(
          lastSelection,
          domSelection,
          nextActiveEditor,
          event
        );
        $setSelection(newSelection);
      }
    });
  }

  // When editor receives selection change event, we're checking if
  // it has any sibling editors (within same parent editor) that were active
  // before, and trigger selection change on it to nullify selection.
  const editors = getEditorsToPropagate(nextActiveEditor);
  const rootEditor = editors[editors.length - 1];
  const rootEditorKey = rootEditor._key;
  const activeNestedEditor = activeNestedEditorsMap.get(rootEditorKey);
  const prevActiveEditor = activeNestedEditor || rootEditor;

  if (prevActiveEditor !== nextActiveEditor) {
    onSelectionChange(domSelection, prevActiveEditor, false);
  }

  onSelectionChange(domSelection, nextActiveEditor, true);

  // If newly selected editor is nested, then add it to the map, clean map otherwise
  if (nextActiveEditor !== rootEditor) {
    activeNestedEditorsMap.set(rootEditorKey, nextActiveEditor);
  } else if (activeNestedEditor) {
    activeNestedEditorsMap.delete(rootEditorKey);
  }
}

/** @internal */
export function stopLexicalPropagation(event: Event): void {
  // We attach a special property to ensure the same event doesn't re-fire
  // for parent editors.
  // @ts-ignore
  event._lexicalHandled = true;
}

export function hasStoppedLexicalPropagation(event: Event): boolean {
  // @ts-ignore
  const stopped = event._lexicalHandled === true;
  return stopped;
}

export type EventHandler = (event: Event, editor: LexicalEditor) => void;

export function addRootElementEvents(
  rootElement: HTMLElement,
  editor: LexicalEditor
): void {
  // We only want to have a single global selectionchange event handler, shared
  // between all editor instances.
  const doc = rootElement.ownerDocument;
  rootElementToDocument.set(rootElement, doc);
  const documentRootElementsCount = rootElementsRegistered.get(doc) ?? 0;
  if (documentRootElementsCount < 1) {
    doc.addEventListener('selectionchange', onDocumentSelectionChange);
  }
  rootElementsRegistered.set(doc, documentRootElementsCount + 1);

  // @ts-expect-error: internal field
  rootElement.__lexicalEditor = editor;
  const removeHandles = getRootElementRemoveHandles(rootElement);

  for (let i = 0; i < rootElementEvents.length; i++) {
    const [eventName, onEvent] = rootElementEvents[i];
    const eventHandler =
      typeof onEvent === 'function'
        ? (event: Event) => {
            if (hasStoppedLexicalPropagation(event)) {
              return;
            }
            stopLexicalPropagation(event);
            if (editor.isEditable() || eventName === 'click') {
              onEvent(event, editor);
            }
          }
        : (event: Event) => {
            if (hasStoppedLexicalPropagation(event)) {
              return;
            }
            stopLexicalPropagation(event);
            const isEditable = editor.isEditable();
            switch (eventName) {
              case 'cut':
                return (
                  isEditable &&
                  dispatchCommand(editor, CUT_COMMAND, event as ClipboardEvent)
                );

              case 'copy':
                return dispatchCommand(
                  editor,
                  COPY_COMMAND,
                  event as ClipboardEvent
                );

              case 'paste':
                return (
                  isEditable &&
                  dispatchCommand(
                    editor,
                    PASTE_COMMAND,
                    event as ClipboardEvent
                  )
                );

              case 'dragstart':
                return (
                  isEditable &&
                  dispatchCommand(editor, DRAGSTART_COMMAND, event as DragEvent)
                );

              case 'dragover':
                return (
                  isEditable &&
                  dispatchCommand(editor, DRAGOVER_COMMAND, event as DragEvent)
                );

              case 'dragend':
                return (
                  isEditable &&
                  dispatchCommand(editor, DRAGEND_COMMAND, event as DragEvent)
                );

              case 'focus':
                return (
                  isEditable &&
                  dispatchCommand(editor, FOCUS_COMMAND, event as FocusEvent)
                );

              case 'blur': {
                return (
                  isEditable &&
                  dispatchCommand(editor, BLUR_COMMAND, event as FocusEvent)
                );
              }

              case 'drop':
                return (
                  isEditable &&
                  dispatchCommand(editor, DROP_COMMAND, event as DragEvent)
                );
            }
          };
    rootElement.addEventListener(eventName, eventHandler);
    removeHandles.push(() => {
      rootElement.removeEventListener(eventName, eventHandler);
    });
  }
}

export const rootElementNotRegisteredWarning = warnOnlyOnce(
  'Root element not registered'
);

export function removeRootElementEvents(rootElement: HTMLElement): void {
  const doc = rootElementToDocument.get(rootElement);
  if (doc === undefined) {
    rootElementNotRegisteredWarning();
    return;
  }

  const documentRootElementsCount = rootElementsRegistered.get(doc);
  if (documentRootElementsCount === undefined) {
    // This can happen if setRootElement() failed
    rootElementNotRegisteredWarning();
    return;
  }

  // We only want to have a single global selectionchange event handler, shared
  // between all editor instances.
  const newCount = documentRootElementsCount - 1;
  invariant(newCount >= 0, 'Root element count less than 0');
  rootElementToDocument.delete(rootElement);
  rootElementsRegistered.set(doc, newCount);
  if (newCount === 0) {
    doc.removeEventListener('selectionchange', onDocumentSelectionChange);
  }

  const editor = getEditorPropertyFromDOMNode(rootElement);

  if (isLexicalEditor(editor)) {
    cleanActiveNestedEditorsMap(editor);
    // @ts-expect-error: internal field
    rootElement.__lexicalEditor = null;
  } else if (editor) {
    invariant(
      false,
      'Attempted to remove event handlers from a node that does not belong to this build of Lexical'
    );
  }

  const removeHandles = getRootElementRemoveHandles(rootElement);

  for (let i = 0; i < removeHandles.length; i++) {
    removeHandles[i]();
  }

  // @ts-expect-error: internal field
  rootElement.__lexicalEventHandles = [];
}

export function cleanActiveNestedEditorsMap(editor: LexicalEditor) {
  if (editor._parentEditor !== null) {
    // For nested editor cleanup map if this editor was marked as active
    const editors = getEditorsToPropagate(editor);
    const rootEditor = editors[editors.length - 1];
    const rootEditorKey = rootEditor._key;

    if (activeNestedEditorsMap.get(rootEditorKey) === editor) {
      activeNestedEditorsMap.delete(rootEditorKey);
    }
  } else {
    // For top-level editors cleanup map
    activeNestedEditorsMap.delete(editor._key);
  }
}

export function markSelectionChangeFromDOMUpdate(): void {
  eventsState.isSelectionChangeFromDOMUpdate = true;
}

export function markCollapsedSelectionFormat(
  format: number,
  style: string,
  offset: number,
  key: NodeKey,
  timeStamp: number
): void {
  eventsState.collapsedSelectionFormat = [
    format,
    style,
    offset,
    key,
    timeStamp,
  ];
}

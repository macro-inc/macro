/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * MIT licensed. Retargeted LexicalEvents.ts handlers and controlled-input gates.
 * Pin: Lexical 0.45.0 / 0cfcc169296723e07de2396cd42ea3434b5b79ed.
 */

import {
  CommandCode,
  EditorInputMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import { textLeaf } from './dom';
import { DragAccess } from './drag';
import { externalEditorRootOwner } from './editor-roots';
import { EditorView } from './editor-view';
import {
  isSelectionWithinEditor,
  readFocusedRootSelection,
  readSelection,
  readSelectionFromChange,
  resolvePoint,
  sameSelection,
} from './selection';
import { consumeSelectionChangeFromDOMUpdate } from './selection-change';
import { selectionMessage } from './session-port';
import type { ViewSelection } from './types';

const documents = new WeakMap<
  Document,
  { listeners: Map<Node, () => void>; dispatch: () => void }
>();
function registerSelectionChange(
  root: HTMLElement,
  listener: () => void
): () => void {
  const doc = root.ownerDocument;
  let entry = documents.get(doc);
  if (!entry) {
    const listeners = new Map<Node, () => void>();
    const dispatch = () => {
      for (
        let node: Node | null = doc.getSelection()?.anchorNode ?? null;
        node;
        node = node.parentNode
      ) {
        if (externalEditorRootOwner(node) !== undefined) return;
        const listener = listeners.get(node);
        if (listener) {
          listener();
          return;
        }
      }
    };
    entry = { listeners, dispatch };
    documents.set(doc, entry);
    doc.addEventListener('selectionchange', dispatch);
  }
  const current = entry;
  current.listeners.set(root, listener);
  return () => {
    current.listeners.delete(root);
    if (!current.listeners.size) {
      doc.removeEventListener('selectionchange', current.dispatch);
      documents.delete(doc);
    }
  };
}

/** EVT-14/15: mirror policy plus the two facts only the DOM can provide. */
export function shouldPreventDefaultAndInsertText(
  view: EditorView,
  text: string,
  event: InputEvent
): boolean {
  const selection = readSelection(view),
    info = view.selection();
  const domSelection = view.root.ownerDocument.getSelection();
  const target = event.getTargetRanges?.()[0];
  let facts =
    target &&
    (!target.collapsed ||
      target.startContainer !== domSelection?.anchorNode ||
      target.startOffset !== domSelection.anchorOffset)
      ? 4
      : 0;
  let result = true;
  if (selection.kind === 'range' && selection.anchor.type === 'text') {
    const { anchor, focus } = selection;
    const node = view.node(anchor.key),
      props = node?.textProps;
    if (node && props) {
      const dom = textLeaf(view.getElementByKey(node.key));
      if (domSelection?.anchorNode !== dom) facts |= 2;
      const parent = node.parent === null ? null : view.node(node.parent);
      const nodeFlags = view.flags(node);
      const parentFlags = parent ? view.flags(parent) : undefined;
      const siblings = parent?.children ?? [];
      const previousKey = siblings[siblings.indexOf(node.key) - 1];
      const previous =
        previousKey === undefined ? null : view.node(previousKey);
      const previousFlags = previous ? view.flags(previous) : undefined;
      const before =
        anchor.offset === 0 &&
        (nodeFlags?.canInsertTextBefore === false ||
          parentFlags?.canInsertTextBefore === false ||
          node.type === 'tab' ||
          Boolean(
            previous &&
              (previous.kind === 'text' || previousFlags?.isInline) &&
              previousFlags?.canInsertTextAfter === false
          ));
      const after =
        anchor.offset === node.text.length &&
        (nodeFlags?.canInsertTextAfter === false ||
          parentFlags?.canInsertTextAfter === false ||
          node.type === 'tab');
      const collapsed =
        anchor.key === focus.key && anchor.offset === focus.offset;
      result =
        anchor.key !== focus.key ||
        (/[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(text) &&
          anchor.offset !== focus.offset) ||
        props.mode !== 0 ||
        Boolean(facts & 6) ||
        props.format !== info.format ||
        props.style !== info.style ||
        (collapsed && (before || after));
    }
  }
  const expected = view.port.debugInsertion(
    selection,
    info.format,
    info.style,
    text,
    facts
  );
  if (expected !== undefined && expected !== result)
    throw new Error('EVT-14 insertion predicate diverged from Rust');
  return result;
}

function target(
  view: EditorView,
  event: Pick<InputEvent, 'getTargetRanges'>,
  backward: boolean,
  granularity: 'character' | 'word' | 'lineboundary'
) {
  const empty = { key: 0, offset: 0, type: 0 };
  const none = { kind: 0, anchor: empty, focus: empty, dirty: false, backward };
  const selection = readSelection(view);
  const range = event.getTargetRanges?.()[0];
  if (range && !range.collapsed) {
    const anchor = resolvePoint(view, range.startContainer, range.startOffset),
      focus = resolvePoint(view, range.endContainer, range.endOffset);
    if (anchor && focus)
      return {
        ...none,
        kind: 1,
        anchor: { ...anchor, type: anchor.type === 'text' ? 0 : 1 },
        focus: { ...focus, type: focus.type === 'text' ? 0 : 1 },
      };
  }
  if (
    granularity === 'character' &&
    selection.kind === 'range' &&
    selection.anchor.key === selection.focus.key &&
    selection.anchor.offset === selection.focus.offset &&
    selection.anchor.type === 'text'
  ) {
    const node = view.node(selection.anchor.key);
    const offset = selection.anchor.offset + (backward ? -1 : 1);
    if (
      node &&
      Array.from(node.text).every(
        (character) => character.charCodeAt(0) <= 127
      ) &&
      offset >= 0 &&
      offset <= node.text.length
    ) {
      return {
        ...none,
        kind: 1,
        anchor: { ...selection.anchor, type: 0 },
        focus: { ...selection.anchor, offset, type: 0 },
      };
    }
  }
  const dom = view.root.ownerDocument.getSelection();
  if (!dom?.anchorNode || !dom.focusNode) return none;
  const { anchorNode, anchorOffset, focusNode, focusOffset } = dom;
  dom.modify('extend', backward ? 'backward' : 'forward', granularity);
  const changed = readSelection(view);
  dom.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
  if (changed.kind !== 'range') return none;
  return {
    ...none,
    kind: 1,
    anchor: { ...changed.anchor, type: changed.anchor.type === 'text' ? 0 : 1 },
    focus: { ...changed.focus, type: changed.focus.type === 'text' ? 0 : 1 },
  };
}
export function registerEvents(view: EditorView): {
  dispose: () => void;
  endComposition: () => void;
} {
  const root = view.root,
    doc = root.ownerDocument;
  const listeners: (() => void)[] = [];
  const drag = new DragAccess(view);
  listeners.push(() => drag.dispose());
  let shift = false;
  const shiftDown = (event: KeyboardEvent) => {
    if (event.key === 'Shift') shift = true;
  };
  const shiftUp = (event: KeyboardEvent) => {
    if (event.key === 'Shift') shift = false;
  };
  const pasteWindow = window;
  pasteWindow.addEventListener('keydown', shiftDown);
  pasteWindow.addEventListener('keyup', shiftUp);
  listeners.push(() => {
    pasteWindow.removeEventListener('keydown', shiftDown);
    pasteWindow.removeEventListener('keyup', shiftUp);
  });
  const android =
    /Android/.test(navigator.userAgent) && /Chrome/.test(navigator.userAgent);
  let lastKey = '',
    lastKeyAt = -Infinity;
  let clearTimer: ReturnType<typeof setTimeout> | undefined;
  let restoreTimer: ReturnType<typeof setTimeout> | undefined;
  let postDelete: Extract<ViewSelection, { kind: 'range' }> | null = null;
  listeners.push(() => {
    clearTimeout(clearTimer);
    clearTimeout(restoreTimer);
  });
  let composing = false;
  let endingComposition = false;
  let composingKey: number | null = null;
  let pendingEnd: { key: number; data: string } | null = null;
  let lastSubmittedSelection: ViewSelection = { kind: 'none' };
  let lastSubmittedModelSelection: ViewSelection = { kind: 'none' };
  function rememberSelection(): void {
    lastSubmittedSelection = readSelection(view);
    lastSubmittedModelSelection = view.selection().selection;
  }
  function isLastSubmittedSelection(selection: ViewSelection): boolean {
    return (
      sameSelection(selection, lastSubmittedSelection) &&
      sameSelection(view.selection().selection, lastSubmittedModelSelection)
    );
  }

  const rustListeners = view.port.listeners();
  function listen<K extends keyof HTMLElementEventMap>(
    name: K,
    listener: (event: HTMLElementEventMap[K]) => void
  ): void {
    const wrapped = (event: HTMLElementEventMap[K]) => {
      const allowDecorator = [
        'click',
        'pointerdown',
        'focus',
        'blur',
        'dragstart',
        'dragover',
        'dragend',
        'drop',
      ].includes(name);
      if (view.ownsEvent(event.target, allowDecorator)) listener(event);
    };
    root.addEventListener(name, wrapped);
    listeners.push(() => root.removeEventListener(name, wrapped));
  }
  function command(
    command: number,
    text = '',
    a = 0,
    clearComposition = false,
    completion?: {
      selection: ViewSelection;
      after: (handled: boolean) => void;
    }
  ): void {
    const point = { key: 0, offset: 0, type: 0 };
    const target = {
      kind: 0,
      anchor: point,
      focus: point,
      dirty: false,
      backward: false,
    };
    view.port.input(
      EditorInputMsg.fromEditorCommand({
        command,
        a,
        b: Number(clearComposition),
        text,
        selection: selectionMessage(
          completion?.selection ?? readSelection(view)
        ),
        target,
        characterTarget: target,
      }),
      completion?.after
    );
  }
  listen('keydown', (event) => {
    lastKey = event.key;
    lastKeyAt = event.timeStamp;
    if (composing || event.isComposing) return;
    if (pendingEnd !== null) {
      const pending = pendingEnd;
      pendingEnd = null;
      const selection = readSelection(view);
      view.port.composition(
        1,
        pending.key,
        textLeaf(view.getElementByKey(pending.key))?.nodeValue ?? '',
        selection.kind === 'range' ? selection.anchor.offset : 0,
        selection.kind === 'range' ? selection.focus.offset : 0,
        pending.data
      );
      rememberSelection();
      if (event.key === 'Backspace') event.preventDefault();
      return;
    }
    view.consumePreventDefault();
    if (view.runViewCommand('KeyDown', event, 'before')) {
      event.preventDefault();
      return;
    }
    const keyCommand = [
      'Enter',
      'Backspace',
      'Delete',
      'Tab',
      'Escape',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'End',
    ].includes(event.key)
      ? `Key(${event.key})`
      : event.key === ' '
        ? 'Key(Space)'
        : null;
    if (keyCommand && view.runViewCommand(keyCommand, event, 'before')) {
      event.preventDefault();
      return;
    }
    const route = view.keyRoute(event);
    const generation = view.mirror.keyGeneration;
    if (route && generation !== null) {
      if (route.preventDefault !== false) event.preventDefault();
      const cached = view.selection().selection;
      const selection =
        cached.kind === 'table' || cached.kind === 'node'
          ? { kind: 'keep' as const }
          : readSelection(view);
      view.port.input(
        EditorInputMsg.fromEditorApplication({
          name: route.name,
          json: route.json,
          generation,
          selection: selectionMessage(selection),
          keyboard: true,
          key: event.key,
          mods:
            Number(event.shiftKey) |
            (Number(event.altKey) << 1) |
            (Number(event.ctrlKey) << 2) |
            (Number(event.metaKey) << 3) |
            (Number(event.repeat) << 4) |
            (Number(event.isComposing) << 5),
          code: event.keyCode,
        }),
        (handled) => {
          if (view.consumePreventDefault()) event.preventDefault();
          if (
            !handled &&
            (view.runViewCommand('KeyDown', event, 'after') ||
              (keyCommand && view.runViewCommand(keyCommand, event, 'after')))
          )
            event.preventDefault();
        },
        event
      );
      return;
    }
    const apple = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const wordDelete =
      !event.shiftKey &&
      !event.metaKey &&
      (apple
        ? event.altKey && !event.ctrlKey
        : event.ctrlKey && !event.altKey) &&
      (event.key === 'Backspace' || event.key === 'Delete');
    const lineDelete =
      apple &&
      !event.shiftKey &&
      !event.altKey &&
      ((event.metaKey &&
        !event.ctrlKey &&
        (event.key === 'Backspace' || event.key === 'Delete')) ||
        (event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'k'));
    let formatArgument: number | undefined;
    if (
      !event.shiftKey &&
      !event.altKey &&
      (apple
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey)
    ) {
      switch (event.key.toLowerCase()) {
        case 'b':
          formatArgument = 0;
          break;
        case 'i':
          formatArgument = 1;
          break;
        case 'u':
          formatArgument = 3;
          break;
      }
    }
    if (wordDelete || lineDelete || formatArgument !== undefined) {
      event.preventDefault();
      const backward = event.key === 'Backspace';
      const empty = { key: 0, offset: 0, type: 0 };
      const selectedTarget =
        formatArgument === undefined
          ? target(
              view,
              { getTargetRanges: () => [] },
              backward,
              lineDelete ? 'lineboundary' : 'word'
            )
          : {
              kind: 0,
              anchor: empty,
              focus: empty,
              dirty: false,
              backward: false,
            };
      view.port.input(
        EditorInputMsg.fromEditorKeyDown({
          code: event.keyCode,
          mods:
            Number(event.shiftKey) |
            (Number(event.altKey) << 1) |
            (Number(event.ctrlKey) << 2) |
            (Number(event.metaKey) << 3) |
            (Number(event.repeat) << 4),
          key: event.key,
          command:
            formatArgument !== undefined
              ? CommandCode.FormatText
              : lineDelete
                ? CommandCode.DeleteLine
                : CommandCode.DeleteWord,
          argument: formatArgument ?? (backward ? 0 : 1),
          selection: selectionMessage(readSelection(view)),
          target: selectedTarget,
          characterTarget: { ...selectedTarget, kind: 0 },
        }),
        (handled) => {
          if (!handled) {
            if (view.runViewCommand('KeyDown', event, 'after')) return;
            if (keyCommand) view.runViewCommand(keyCommand, event, 'after');
          }
        }
      );
      return;
    }
    let routed = 0;
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      if (event.key.toLowerCase() === 'z')
        routed = event.shiftKey ? CommandCode.Redo : CommandCode.Undo;
      else if (event.key.toLowerCase() === 'y') routed = CommandCode.Redo;
    }
    if (event.key === 'Tab')
      routed = event.shiftKey ? CommandCode.Outdent : CommandCode.InsertTab;
    let selection =
      routed === CommandCode.Undo || routed === CommandCode.Redo
        ? readSelectionFromChange(view)
        : readSelection(view);
    if (/^(Alt|AltGraph|Control|Meta|Shift)$/.test(event.key)) {
      // A modifier leaves the browser caret in place. Keep a root boundary
      // already admitted as a descendant point, including between Undo and Redo.
      const boundary = readFocusedRootSelection(view);
      if (boundary && sameSelection(boundary, view.selection().selection))
        selection = boundary;
    }
    if (
      !routed &&
      !rustListeners.has('KeyDown') &&
      (!keyCommand ||
        (!rustListeners.has(keyCommand) &&
          !(
            keyCommand === 'Key(Enter)' && view.port.nativeEnter?.hasListeners()
          ))) &&
      (sameSelection(selection, view.selection().selection) ||
        isLastSubmittedSelection(selection))
    )
      return;
    const mods =
      Number(event.shiftKey) |
      (Number(event.altKey) << 1) |
      (Number(event.ctrlKey) << 2) |
      (Number(event.metaKey) << 3) |
      (Number(event.repeat) << 4);
    const handled = view.port.keyDown(
      event.keyCode,
      mods,
      routed,
      event.key,
      selection,
      event
    );
    if (handled === false) {
      if (
        view.runViewCommand('KeyDown', event, 'after') ||
        (keyCommand && view.runViewCommand(keyCommand, event, 'after'))
      )
        event.preventDefault();
    }
    if (routed || view.consumePreventDefault()) event.preventDefault();
  });
  listen('beforeinput', (event) => {
    if (!event.cancelable) return;
    const type = event.inputType;
    let clearComposition = false;
    const selected = readSelection(view);
    if (
      android &&
      type === 'deleteContentBackward' &&
      selected.kind === 'range'
    ) {
      const sameNode = selected.anchor.key === selected.focus.key;
      const key = selected.anchor.key;
      const clear = () =>
        view.port.composition(2, key, '', 0xffffffff, 0xffffffff, '');
      if (
        sameNode &&
        (composing || event.isComposing) &&
        (lastKey === 'MediaLast' ||
          lastKey === 'Process' ||
          lastKey === 'Unidentified') &&
        event.timeStamp < lastKeyAt + 30
      ) {
        composing = false;
        composingKey = null;
        pendingEnd = null;
        lastKeyAt = -Infinity;
        clear();
        clearTimeout(clearTimer);
        clearTimer = setTimeout(clear, 30);
        return;
      }
      const node = view.node(key),
        flags = node ? view.flags(node) : undefined;
      const parent =
        node?.parent === null || node?.parent === undefined
          ? null
          : view.node(node.parent);
      const index = parent?.children.indexOf(key) ?? -1;
      const previous =
        index > 0 ? view.node(parent?.children[index - 1] ?? 0) : null;
      const all =
        selected.anchor.offset === 0 &&
        selected.focus.offset === node?.text.length;
      const collapsed = selected.anchor.offset === selected.focus.offset;
      if (
        sameNode &&
        node?.kind === 'text' &&
        !all &&
        flags?.canInsertTextAfter !== false &&
        !(collapsed && previous?.kind === 'decorator')
      ) {
        clear();
        composing = false;
        composingKey = null;
        return;
      }
      clearComposition = true;
      composing = false;
      composingKey = null;
      pendingEnd = null;
    }
    if (type === 'insertFromComposition') {
      composing = false;
      composingKey = null;
      pendingEnd = null;
      clearComposition = true;
    } else if (!clearComposition && (composing || event.isComposing)) return;
    if (
      type === 'insertText' &&
      !shouldPreventDefaultAndInsertText(view, event.data ?? '', event)
    )
      return;
    event.preventDefault();
    const selection = readSelection(view);
    if (type.startsWith('delete')) {
      const backward = type.endsWith('Backward');
      const word = type.includes('Word'),
        line = type.includes('Line');
      const command = word
        ? CommandCode.DeleteWord
        : line
          ? CommandCode.DeleteLine
          : CommandCode.DeleteCharacter;
      const selectedTarget = target(
        view,
        event,
        backward,
        word ? 'word' : line ? 'lineboundary' : 'character'
      );
      view.port.input(
        EditorInputMsg.fromEditorCommand({
          command,
          a: backward ? 0 : 1,
          b: Number(clearComposition),
          text: '',
          selection: selectionMessage(selection),
          target: selectedTarget,
          characterTarget: { ...selectedTarget, kind: 0 },
        })
      );
      if (android) {
        const after = view.selection().selection;
        postDelete =
          after.kind === 'range' &&
          after.anchor.key === after.focus.key &&
          after.anchor.offset === after.focus.offset
            ? after
            : null;
        clearTimeout(restoreTimer);
        restoreTimer = setTimeout(() => {
          postDelete = null;
        }, 0);
      }
    } else if (type === 'insertParagraph') command(CommandCode.InsertParagraph);
    else if (type === 'insertLineBreak') command(CommandCode.InsertLineBreak);
    else if (type === 'historyUndo') command(CommandCode.Undo);
    else if (type === 'historyRedo') command(CommandCode.Redo);
    else if (type === 'formatBold') command(CommandCode.FormatText, '', 0);
    else if (type === 'formatItalic') command(CommandCode.FormatText, '', 1);
    else if (
      [
        'insertText',
        'insertReplacementText',
        'insertFromComposition',
        'insertFromYank',
        'insertFromDrop',
      ].includes(type)
    )
      command(
        CommandCode.InsertText,
        event.dataTransfer?.getData('text/plain') ?? event.data ?? '',
        0,
        clearComposition
      );
  });
  listen('input', () => {
    if (endingComposition) return;
    const selection = readSelection(view);
    if (selection.kind !== 'range') return;
    if (pendingEnd !== null) {
      const pending = pendingEnd;
      pendingEnd = null;
      const selection = readSelection(view);
      view.port.composition(
        1,
        pending.key,
        textLeaf(view.getElementByKey(pending.key))?.nodeValue ?? '',
        selection.kind === 'range' ? selection.anchor.offset : 0,
        selection.kind === 'range' ? selection.focus.offset : 0,
        pending.data
      );
    } else view.submitText(selection.anchor.key);
    // This selection was admitted with TextFromView even when unrelated
    // effects made its result nonzero and SetViewSelection was elided.
    rememberSelection();
  });
  listen('compositionstart', (event) => {
    const selection = readSelection(view);
    if (selection.kind !== 'range') return;
    composing = true;
    composingKey = selection.anchor.key;
    view.port.composition(
      0,
      selection.anchor.key,
      '',
      selection.anchor.offset,
      selection.focus.offset,
      event.data
    );
  });
  listen('compositionend', (event) => {
    composing = false;
    if (composingKey === null) return;
    const key = composingKey;
    composingKey = null;
    if (
      /AppleWebKit/.test(navigator.userAgent) &&
      !/Chrome/.test(navigator.userAgent)
    ) {
      pendingEnd = { key, data: event.data };
      return;
    }
    const dom = textLeaf(view.getElementByKey(key));
    const selection = readSelection(view);
    view.port.composition(
      1,
      key,
      dom?.nodeValue ?? '',
      selection.kind === 'range' ? selection.anchor.offset : 0,
      selection.kind === 'range' ? selection.focus.offset : 0,
      event.data
    );
  });
  const selectionChange = () => {
    const dom = doc.getSelection();
    if (!dom?.anchorNode || EditorView.fromDOM(dom.anchorNode) !== view) return;
    if (consumeSelectionChangeFromDOMUpdate(dom, postDelete !== null)) return;
    if (
      !isSelectionWithinEditor(
        view,
        dom?.anchorNode ?? null,
        dom?.focusNode ?? null
      )
    )
      return;
    const selection = readSelectionFromChange(view);
    const marked = view.recentSelectionMark();
    const markedRange =
      marked?.selection.kind === 'range' ? marked.selection : null;
    const saved = postDelete;
    postDelete = null;
    const context = {
      domRangeSameNode:
        dom?.type === 'Range' && dom.anchorNode === dom.focusNode,
      domAnchorOffset: dom?.anchorOffset ?? 0,
      domFocusOffset: dom?.focusOffset ?? 0,
      ...(marked && markedRange
        ? {
            marked: {
              format: marked.format,
              style: marked.style,
              anchor: {
                ...markedRange.anchor,
                type: markedRange.anchor.type === 'text' ? 0 : 1,
              },
            },
          }
        : {}),
      ...(saved
        ? {
            postDeleteRestore: {
              anchor: {
                ...saved.anchor,
                type: saved.anchor.type === 'text' ? 0 : 1,
              },
              focus: {
                ...saved.focus,
                type: saved.focus.type === 'text' ? 0 : 1,
              },
              format: view.selection().format,
              style: view.selection().style,
            },
          }
        : {}),
    };
    if (
      saved ||
      context.domRangeSameNode ||
      (selection.kind === 'range' && selection.dirty) ||
      (!sameSelection(selection, view.selection().selection) &&
        !isLastSubmittedSelection(selection))
    ) {
      view.port.selectionFromView(
        selection,
        marked || saved || context.domRangeSameNode ? context : undefined
      );
      rememberSelection();
    }
  };
  listeners.push(registerSelectionChange(root, selectionChange));
  for (const name of ['copy', 'cut'] as const)
    listen(name, (event) => {
      if (!event.clipboardData) return;
      const selected = readSelection(view);
      const current = view.selection().selection;
      if (
        selected.kind === 'range' &&
        current.kind !== 'node' &&
        current.kind !== 'table' &&
        !sameSelection(selected, current)
      ) {
        view.port.selectionFromView(selected);
        rememberSelection();
      }
      const data = view.clipboard.formats(name === 'cut' ? 1 : 0);
      event.clipboardData.setData('text/html', data.html);
      event.clipboardData.setData('text/plain', data.plain);
      event.clipboardData.setData('application/x-lexical-editor', data.lexical);
      event.preventDefault();
      if (name === 'cut') command(CommandCode.RemoveText);
    });
  listen('paste', (event) => {
    if (view.runViewCommand('Paste', event, 'before')) return;
    if (!event.clipboardData) return;
    event.preventDefault();
    view.clipboard
      .paste(event.clipboardData, readSelection(view), { plainOnly: shift })
      .catch(view.options.onError);
  });
  listen('click', (event) => {
    const cached = view.selection().selection;
    const dom = doc.getSelection();
    const pointerRange =
      cached.kind !== 'range' &&
      (event.pointerType === 'touch' || event.pointerType === 'pen');
    if (
      (cached.kind === 'none' || pointerRange) &&
      isSelectionWithinEditor(
        view,
        dom?.anchorNode ?? null,
        dom?.focusNode ?? null
      )
    ) {
      const selection = readSelection(view);
      if (selection.kind === 'range') {
        view.port.selectionFromView(selection);
        rememberSelection();
      }
    }
    if (view.runViewCommand('Click', event, 'before')) return;
    if (event.detail === 3) {
      view.port.selectionFromView(readSelection(view), { tripleClick: true });
      rememberSelection();
    }
    command(CommandCode.Click, '', 0, false, {
      selection: { kind: 'keep' },
      after: (handled) => {
        if (!handled) view.runViewCommand('Click', event, 'after');
      },
    });
  });
  listen('pointerdown', (event) => {
    view.runViewCommand('PointerDown', event, 'before');
  });
  listen('focus', (event) => {
    view.runViewCommand('Focus', event, 'before');
  });
  listen('blur', (event) => {
    view.runViewCommand('Blur', event, 'before');
  });
  listen('dragstart', (event) => drag.start(event));
  listen('dragover', (event) => drag.over(event));
  listen('dragend', (event) => drag.end(event));
  listen('drop', (event) => {
    drag.drop(event).catch(view.options.onError);
  });
  return {
    dispose: () => {
      for (const remove of listeners) remove();
    },
    endComposition: () => {
      if (!composing && pendingEnd === null) return;
      // Rust has committed every input already. Finish the native IME before
      // painting the merged remote text; its synchronous end event is redundant.
      composing = false;
      composingKey = null;
      pendingEnd = null;
      const focused = doc.activeElement === root;
      endingComposition = true;
      try {
        root.blur();
        if (focused) root.focus({ preventScroll: true });
      } finally {
        endingComposition = false;
      }
    },
  };
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * MIT licensed. Retargeted LexicalEvents.ts handlers and controlled-input gates.
 * Pin: Lexical 0.45.0 / 0cfcc169296723e07de2396cd42ea3434b5b79ed.
 */
import {
  CommandCode,
  EditorInputMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import { DragAccess } from './drag';
import type { EditorView } from './editor-view';
import { readSelection, resolvePoint, sameSelection } from './selection';
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
      for (let node = doc.activeElement; node; node = node.parentElement) {
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
      const dom = view.getElementByKey(node.key)?.firstChild;
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
  event: InputEvent,
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
  if (granularity === 'character' && selection.kind === 'range') {
    const node = view.node(selection.anchor.key);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: The character-deletion fast path deliberately includes every ASCII code unit.
    if (node && /^[\x00-\x7f]*$/.test(node.text)) return none;
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
  let composing = false;
  let endingComposition = false;
  let composingKey: number | null = null;
  let pendingEnd: { key: number; data: string } | null = null;
  let lastSubmittedSelection: ViewSelection = { kind: 'none' };
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
  function command(command: number, text = '', a = 0): void {
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
        b: 0,
        text,
        selection: selectionMessage(readSelection(view)),
        target,
        characterTarget: target,
      })
    );
  }
  listen('keydown', (event) => {
    if (composing || event.isComposing) return;
    if (pendingEnd !== null) {
      const pending = pendingEnd;
      pendingEnd = null;
      const selection = readSelection(view);
      view.port.composition(
        1,
        pending.key,
        view.getElementByKey(pending.key)?.firstChild?.nodeValue ?? '',
        selection.kind === 'range' ? selection.anchor.offset : 0,
        selection.kind === 'range' ? selection.focus.offset : 0,
        pending.data
      );
      lastSubmittedSelection = readSelection(view);
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
    let routed = 0;
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      if (event.key.toLowerCase() === 'z')
        routed = event.shiftKey ? CommandCode.Redo : CommandCode.Undo;
      else if (event.key.toLowerCase() === 'y') routed = CommandCode.Redo;
      else if (event.key.toLowerCase() === 'b') {
        event.preventDefault();
        command(CommandCode.FormatText, '', 1);
        return;
      } else if (event.key.toLowerCase() === 'i') {
        event.preventDefault();
        command(CommandCode.FormatText, '', 2);
        return;
      }
    }
    if (event.key === 'Tab')
      routed = event.shiftKey ? CommandCode.Outdent : CommandCode.InsertTab;
    const selection = readSelection(view);
    if (
      !routed &&
      !rustListeners.has('KeyDown') &&
      (!keyCommand || !rustListeners.has(keyCommand)) &&
      (sameSelection(selection, view.selection().selection) ||
        sameSelection(selection, lastSubmittedSelection))
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
      selection
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
    if (!event.cancelable || composing || event.isComposing) return;
    const type = event.inputType;
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
          a: Number(backward),
          b: 0,
          text: '',
          selection: selectionMessage(selection),
          target: selectedTarget,
          characterTarget: { ...selectedTarget, kind: 0 },
        })
      );
    } else if (type === 'insertParagraph') command(CommandCode.InsertParagraph);
    else if (type === 'insertLineBreak') command(CommandCode.InsertLineBreak);
    else if (type === 'historyUndo') command(CommandCode.Undo);
    else if (type === 'historyRedo') command(CommandCode.Redo);
    else if (type === 'formatBold') command(CommandCode.FormatText, '', 1);
    else if (type === 'formatItalic') command(CommandCode.FormatText, '', 2);
    else if (type === 'insertText' || type === 'insertReplacementText')
      command(CommandCode.InsertText, event.data ?? '');
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
        view.getElementByKey(pending.key)?.firstChild?.nodeValue ?? '',
        selection.kind === 'range' ? selection.anchor.offset : 0,
        selection.kind === 'range' ? selection.focus.offset : 0,
        pending.data
      );
    } else view.submitText(selection.anchor.key);
    // This selection was admitted with TextFromView even when unrelated
    // effects made its result nonzero and SetViewSelection was elided.
    lastSubmittedSelection = readSelection(view);
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
    const dom = view.getElementByKey(key)?.firstChild;
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
    if (!doc.activeElement || !view.ownsSelection(doc.activeElement)) return;
    const selection = readSelection(view);
    if (
      !sameSelection(selection, view.selection().selection) &&
      !sameSelection(selection, lastSubmittedSelection)
    ) {
      view.port.selectionFromView(selection);
      lastSubmittedSelection = readSelection(view);
    }
  };
  listeners.push(registerSelectionChange(root, selectionChange));
  for (const name of ['copy', 'cut'] as const)
    listen(name, (event) => {
      if (!event.clipboardData) return;
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
      .paste(event.clipboardData, readSelection(view))
      .catch(view.options.onError);
  });
  listen('click', (event) => {
    if (view.runViewCommand('Click', event, 'before')) return;
    const key =
      event.target instanceof Node ? view.keyFromDOM(event.target) : null;
    if (key !== null && view.node(key)?.kind === 'decorator') {
      const node = view.node(key);
      if (node && view.flags(node)?.isKeyboardSelectable !== false)
        view.port.selectionFromView({ kind: 'node', keys: [key] });
    }
    view.runViewCommand('Click', event, 'after');
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

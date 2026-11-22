import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { KEY_DOWN_COMMAND } from '@macro-inc/lexical-wasm-view/view/commands';
import type { NodeKey, Point } from '@macro-inc/lexical-wasm-view/view/types';
import { $getRoot, type LexicalEditor } from 'lexical';
import { dispatchApplicationCommand } from '../../plugins/group-b/command';
import { isRectFlushWith } from '../../utils';

const ROOT: NodeKey = 0;
const CODE_TYPES = ['code', 'custom-code'];
// Source keyNavigationPlugin runs at COMMAND_PRIORITY_NORMAL, ahead of the
// editor's own arrow and Backspace handling.
const PRIORITY = 2;

interface TitleHandoffOptions {
  readonly titleEditor: () => LexicalEditor | undefined;
  readonly menuOpen: () => boolean;
}

function collapsedPoint(view: EditorView): Point | null {
  const selection = view.selection().selection;
  if (selection.kind !== 'range') return null;
  const { anchor, focus } = selection;
  if (anchor.key !== focus.key || anchor.offset !== focus.offset) return null;
  return anchor;
}

function indexWithinParent(view: EditorView, key: NodeKey): number {
  const parent = view.node(key)?.parent;
  if (parent === null || parent === undefined) return -1;
  return view.node(parent)?.children.indexOf(key) ?? -1;
}

function firstRootChild(view: EditorView): NodeKey | undefined {
  return view.node(ROOT)?.children[0];
}

function insideCode(view: EditorView, key: NodeKey): boolean {
  for (
    let k: NodeKey | null = key;
    k !== null;
    k = view.node(k)?.parent ?? null
  )
    if (CODE_TYPES.includes(view.node(k)?.type ?? '')) return true;
  return false;
}

function textContent(view: EditorView, key: NodeKey): string {
  const node = view.node(key);
  if (!node) return '';
  if (node.kind === 'text') return node.text;
  return node.children.map((child) => textContent(view, child)).join('');
}

/** Source DOM caret rect; the native view keeps the DOM range authoritative. */
function caretRect(): DOMRect | null {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
  if (!range) return null;
  const rects = range.getClientRects();
  if (rects.length) return rects[rects.length - 1];
  const container = range.commonAncestorContainer;
  return container instanceof HTMLElement
    ? container.getBoundingClientRect()
    : null;
}

function selectTitle(title: LexicalEditor, edge: 'start' | 'end') {
  title.update(() => {
    const first = $getRoot().getFirstChild();
    if (edge === 'start') first?.selectStart();
    else first?.selectEnd();
  });
}

/**
 * Source keyNavigationPlugin over the native body: ArrowUp on the top line,
 * ArrowLeft at the document start and Backspace at the start of the first
 * paragraph move into the title.
 */
export function registerNativeTitleHandoffKeys(
  view: EditorView,
  options: TitleHandoffOptions
) {
  const arrowUp = (title: LexicalEditor) => {
    const selection = view.selection().selection;
    if (selection.kind !== 'range') return false;
    if (insideCode(view, selection.focus.key)) return false;
    if (insideCode(view, selection.anchor.key)) return false;
    const rect = view.root.getBoundingClientRect();
    if (!isRectFlushWith(caretRect() ?? rect, rect, 'top', 5)) return false;
    selectTitle(title, 'start');
    return true;
  };
  const arrowLeft = (title: LexicalEditor) => {
    const point = collapsedPoint(view);
    if (!point || point.offset !== 0) return false;
    if (indexWithinParent(view, point.key) !== 0) return false;
    const parent = view.node(point.key)?.parent ?? null;
    if (parent !== firstRootChild(view) && parent !== ROOT) return false;
    selectTitle(title, 'end');
    return true;
  };
  const backspace = (title: LexicalEditor) => {
    const point = collapsedPoint(view);
    if (!point || point.offset !== 0) return false;
    if (indexWithinParent(view, point.key) !== 0) return false;
    const node = view.node(point.key);
    const parent = node?.kind === 'text' ? node.parent : point.key;
    if (parent === null || parent !== firstRootChild(view)) return false;
    const block = view.node(parent);
    if (block?.type !== 'paragraph') return false;
    if ((block.elementProps?.indent ?? 0) !== 0) return false;
    if (
      textContent(view, parent) === '' &&
      (view.node(ROOT)?.children.length ?? 0) > 1
    )
      // Source captures the key now and removes that node in a microtask.
      queueMicrotask(() =>
        dispatchApplicationCommand(
          view,
          'group-b.remove-leading-empty-paragraph',
          { key: parent }
        )
      );
    selectTitle(title, 'end');
    return true;
  };
  return view.registerViewCommand(
    KEY_DOWN_COMMAND,
    (event) => {
      const title = options.titleEditor();
      if (!title || options.menuOpen()) return false;
      // Lexical isMoveUp / isMoveBackward / isDeleteBackward modifier rules.
      if (event.ctrlKey || event.metaKey) return false;
      if (event.key === 'ArrowUp') return arrowUp(title);
      if (event.altKey) return false;
      if (event.key === 'ArrowLeft') return arrowLeft(title);
      if (event.key === 'Backspace') return backspace(title);
      return false;
    },
    PRIORITY
  );
}

import {
  type SearchOperatorBinding,
  searchOperatorSpans,
} from '@app/features/next-soup/core/search-operators';
import type { LexicalEditor } from 'lexical';

/**
 * The highlight the Search field draws typed operators with, styled by
 * `::highlight(search-operator)` in index.css. A CSS highlight paints text
 * without changing the editor's content, so typing, the caret and mention
 * pills behave as they do without it.
 */
const HIGHLIGHT = 'search-operator';

/** Each mounted field's operator ranges; a page has one highlight registry. */
const fieldRanges = new Map<LexicalEditor, Range[]>();

function redraw() {
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) return;
  const ranges = [...fieldRanges.values()].flat();
  if (ranges.length === 0) CSS.highlights.delete(HIGHLIGHT);
  else CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges));
}

type Segment = { node: Text; start: number };

/**
 * The field's editable text, with where each text node starts in it. A
 * non-editable element, such as a mention pill, reads as one space, so an
 * operator never runs into it.
 */
function fieldText(root: HTMLElement): { text: string; segments: Segment[] } {
  let text = '';
  const segments: Segment[] = [];
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child instanceof Text) {
        segments.push({ node: child, start: text.length });
        text += child.data;
      } else if (child instanceof HTMLElement) {
        if (child.getAttribute('contenteditable') === 'false') text += ' ';
        else walk(child);
      }
    }
  };
  walk(root);
  return { text, segments };
}

/** The text node holding `offset`, and the offset inside it. */
function position(segments: Segment[], offset: number, atEnd: boolean) {
  for (const segment of segments) {
    const inside = offset - segment.start;
    const length = segment.node.data.length;
    if (inside >= 0 && (atEnd ? inside <= length : inside < length)) {
      return { node: segment.node, offset: inside };
    }
  }
  return undefined;
}

/** The ranges of the typed operators in a field's text. */
export function operatorRanges(
  root: HTMLElement,
  bindings: readonly SearchOperatorBinding[] = []
): Range[] {
  const { text, segments } = fieldText(root);
  return searchOperatorSpans(text, bindings).flatMap(({ start, end }) => {
    const from = position(segments, start, false);
    const to = position(segments, end, true);
    if (!from || !to) return [];
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    return [range];
  });
}

/**
 * Draws the typed operators in a Search field's editor, in the accent colour,
 * with the tokens `bindings` holds among them.
 */
export const searchOperatorHighlights =
  (bindings: () => readonly SearchOperatorBinding[]) =>
  (editor: LexicalEditor): (() => void) => {
    const draw = () => {
      const root = editor.getRootElement();
      fieldRanges.set(editor, root ? operatorRanges(root, bindings()) : []);
      redraw();
    };
    const unregisterUpdate = editor.registerUpdateListener(draw);
    const unregisterRoot = editor.registerRootListener(draw);
    draw();
    return () => {
      unregisterUpdate();
      unregisterRoot();
      fieldRanges.delete(editor);
      redraw();
    };
  };

/**
 * Content offsets inside a rendered DOCX block, in the same space the
 * Docxodus editor uses for its own selection spans: generated chrome (list
 * numbers, note references) and injected bidi marks do not count, and a field
 * counts as its cached result.
 */

const GENERATED_CHROME =
  '[data-list-marker], a.footnote-ref, a.endnote-ref, a[class$="-backref"], a.comment-marker';
const BIDI_MARKS = /[‎‏؜‪-‮⁦-⁩]/;
const BIDI_MARKS_GLOBAL = new RegExp(BIDI_MARKS.source, 'g');

function stripBidi(text: string): string {
  return text.replace(BIDI_MARKS_GLOBAL, '');
}

function isElement(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

function isChrome(node: Node, block: Element): boolean {
  let element: Element | null = isElement(node) ? node : node.parentElement;
  while (element && element !== block) {
    if (element.matches(GENERATED_CHROME)) return true;
    element = element.parentElement;
  }
  return false;
}

function isField(node: Node): node is HTMLElement {
  return isElement(node) && node.hasAttribute('data-field');
}

function fieldText(field: HTMLElement): string {
  return stripBidi(field.dataset.fieldCached ?? field.textContent ?? '');
}

/** The block (rendered paragraph) a node belongs to, inside `root`. */
export function blockOf(node: Node | null, root: Element): HTMLElement | null {
  let element: Element | null =
    node && isElement(node) ? node : (node?.parentElement ?? null);
  while (element && element !== root) {
    if (element.hasAttribute('data-anchor') && element instanceof HTMLElement)
      return element;
    element = element.parentElement;
  }
  return null;
}

/** The block's text in content-offset space. */
export function contentText(block: Element): string {
  let out = '';
  const walk = (node: Node) => {
    if (isField(node)) out += fieldText(node);
    else if (node.nodeType === Node.TEXT_NODE) {
      if (!isChrome(node, block)) out += stripBidi(node.textContent ?? '');
    } else node.childNodes.forEach(walk);
  };
  walk(block);
  return out;
}

/** Content offset of a DOM position (container + offset) inside `block`. */
export function contentOffset(
  block: Element,
  container: Node,
  offset: number
): number {
  let count = 0;
  let done = false;
  const walk = (node: Node) => {
    if (done) return;
    if (isField(node)) {
      const inside = node === container || node.contains(container);
      if (!inside || offset > 0 || node !== container)
        count += fieldText(node).length;
      if (inside) done = true;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const chrome = isChrome(node, block);
      if (node === container) {
        if (!chrome)
          count += stripBidi((node.textContent ?? '').slice(0, offset)).length;
        done = true;
        return;
      }
      if (!chrome) count += stripBidi(node.textContent ?? '').length;
      return;
    }
    if (node === container) {
      const children = Array.from(node.childNodes);
      for (let i = 0; i < offset && i < children.length; i++) walk(children[i]);
      done = true;
      return;
    }
    node.childNodes.forEach(walk);
  };
  walk(block);
  return count;
}

type Point = { node: Node; offset: number };

/** The DOM position at content offset `target`, or null past the end. */
function pointAt(
  block: Element,
  target: number,
  preferEnd: boolean
): Point | null {
  let count = 0;
  let found: Point | null = null;
  const walk = (node: Node): boolean => {
    if (isField(node)) {
      const length = fieldText(node).length;
      if (
        target <= count + length &&
        (preferEnd ? target > count : target < count + length)
      ) {
        const parent = node.parentNode;
        if (!parent) return false;
        const index = Array.prototype.indexOf.call(parent.childNodes, node);
        found = { node: parent, offset: preferEnd ? index + 1 : index };
        return true;
      }
      count += length;
      return false;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      if (isChrome(node, block)) return false;
      const raw = node.textContent ?? '';
      const length = stripBidi(raw).length;
      const hit = preferEnd
        ? target > count && target <= count + length
        : target >= count && target < count + length;
      if (hit) {
        let content = count;
        for (let i = 0; i <= raw.length; i++) {
          if (
            content === target &&
            (i === raw.length || !BIDI_MARKS.test(raw[i]))
          ) {
            found = { node, offset: i };
            return true;
          }
          if (i < raw.length && !BIDI_MARKS.test(raw[i])) content++;
        }
      }
      count += length;
      return false;
    }
    for (const child of Array.from(node.childNodes))
      if (walk(child)) return true;
    return false;
  };
  walk(block);
  return found;
}

/** A DOM range covering content offsets [start, start + length) of `block`. */
export function contentRange(
  block: Element,
  start: number,
  length: number
): Range | null {
  if (length <= 0) return null;
  const from = pointAt(block, start, false);
  const to = pointAt(block, start + length, true);
  if (!from || !to) return null;
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range.collapsed ? null : range;
}

/** A collapsed range at content offset `offset` of `block` (clamped to its end). */
export function caretRange(block: Element, offset: number): Range | null {
  const length = contentText(block).length;
  const target = Math.max(0, Math.min(offset, length));
  const point =
    target > 0 ? pointAt(block, target, true) : pointAt(block, 0, false);
  const range = document.createRange();
  if (point) range.setStart(point.node, point.offset);
  else range.selectNodeContents(block);
  range.collapse(true);
  return range;
}

/**
 * The part of `range` that falls inside one block: the block where the range
 * starts, clamped to that block's end when the range continues past it.
 */
export function blockSpanOfRange(
  range: Range,
  root: Element
): { block: HTMLElement; start: number; length: number } | null {
  const block = blockOf(range.startContainer, root);
  if (!block) return null;
  const start = contentOffset(block, range.startContainer, range.startOffset);
  const end = block.contains(range.endContainer)
    ? contentOffset(block, range.endContainer, range.endOffset)
    : contentText(block).length;
  if (end <= start) return null;
  return { block, start, length: end - start };
}

/**
 * Where the caret belongs after `before` became `after`, as undo and redo
 * place it: the end of the text that changed, in `after`'s offsets.
 */
export function changedTextEnd(before: string, after: string): number {
  const limit = Math.min(before.length, after.length);
  let start = 0;
  while (start < limit && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < limit - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++;
  return after.length - end;
}

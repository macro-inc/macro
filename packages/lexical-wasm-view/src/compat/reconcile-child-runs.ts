import { ChildTextIndex } from './child-text-index';
import type { ElementDOMSlot } from './dom-slot';
import { getNextSibling } from './reconcile-children';
import { reconcilerState } from './reconciler-state';

interface ChildRun {
  first: string;
  count: number;
  clean: boolean;
}
/** Compress untouched spans while retaining the pinned two-cursor positions. */
export function childRuns(
  index: ChildTextIndex,
  keys: readonly string[]
): ChildRun[] {
  const runs: ChildRun[] = [];
  let start = 0;
  for (const key of keys) {
    const rank = index.rank(key);
    if (rank > start)
      runs.push({
        first: index.keyAt(start),
        count: rank - start,
        clean: true,
      });
    runs.push({ first: key, count: 1, clean: false });
    start = rank + 1;
  }
  if (start < index.count)
    runs.push({
      first: index.keyAt(start),
      count: index.count - start,
      clean: true,
    });
  return runs;
}
class Cursor {
  private run = 0;
  private offset = 0;
  constructor(
    private readonly runs: readonly ChildRun[],
    private readonly index: ChildTextIndex
  ) {}
  get done(): boolean {
    return this.run === this.runs.length;
  }
  get clean(): boolean {
    return this.runs[this.run].clean;
  }
  get remaining(): number {
    return this.runs[this.run].count - this.offset;
  }
  key(ahead = 0): string {
    const run = this.runs[this.run];
    return run.clean
      ? this.index.keyAt(this.index.rank(run.first) + this.offset + ahead)
      : run.first;
  }
  advance(count = 1): void {
    this.offset += count;
    if (this.offset === this.runs[this.run].count) {
      this.run++;
      this.offset = 0;
    }
  }
}
export type ChildAction = 'equal' | 'move' | 'create';
const precedes = (a: Node, b: Node): boolean =>
  (a.compareDocumentPosition(b) & 4) !== 0;
/** Only changed/boundary keys, ordered by the current DOM position. */
class ChangedDOM {
  private readonly index: ChildTextIndex;
  constructor(
    keys: readonly string[],
    private readonly slot: ElementDOMSlot,
    private readonly getDOM: (key: string) => HTMLElement
  ) {
    this.index = new ChildTextIndex(
      keys
        .filter((key) => getDOM(key).parentNode === slot.element)
        .map((key) => ({ key, text: '', firstText: null }))
    );
  }
  remove(key: string): void {
    this.index.delete(key);
  }
  private lowerBound(boundary: Node, strict: boolean): number {
    let low = 0,
      high = this.index.count;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const dom = this.getDOM(this.index.keyAt(middle));
      if (precedes(dom, boundary) || (strict && dom === boundary))
        low = middle + 1;
      else high = middle;
    }
    return low;
  }
  track(key: string): void {
    this.index.delete(key);
    const dom = this.getDOM(key);
    if (dom.parentNode !== this.slot.element) return;
    const rank = this.lowerBound(dom, false);
    this.index.insertAfter(
      { key, text: '', firstText: null },
      rank === 0 ? null : this.index.keyAt(rank - 1)
    );
  }
  range(start: Node, end: Node | null, strict: boolean): string[] {
    const first = this.lowerBound(start, strict);
    const last = end === null ? this.index.count : this.lowerBound(end, false);
    const keys: string[] = [];
    for (let i = first; i < last; i++) keys.push(this.index.keyAt(i));
    return keys;
  }
}
/** Batch clean moves by relocating only the displaced changed nodes. */
function moveCleanRun(
  first: HTMLElement,
  last: HTMLElement,
  before: Node | null,
  changed: ChangedDOM,
  slot: ElementDOMSlot,
  getDOM: (key: string) => HTMLElement
): Node | null {
  const prior = changed.range(first, before, true);
  const after = before === null ? [] : changed.range(before, last, false);
  const boundary = last.nextSibling;
  // Remove all displaced entries before the DOM changes so each reinsertion's
  // binary search observes an already ordered index of the remaining keys.
  for (const key of [...prior, ...after]) changed.remove(key);
  for (const key of prior) {
    slot.element.insertBefore(getDOM(key), first);
    changed.track(key);
  }
  for (const key of after) {
    slot.element.insertBefore(getDOM(key), boundary);
    changed.track(key);
  }
  if (
    before !== null &&
    (before === first ||
      before === last ||
      (precedes(first, before) && precedes(before, last)))
  )
    return getNextSibling(last);
  return before;
}

export function reconcileChildRuns(
  previousRuns: readonly ChildRun[],
  nextRuns: readonly ChildRun[],
  index: ChildTextIndex,
  parent: string,
  slot: ElementDOMSlot,
  render: (
    key: string,
    action: ChildAction,
    before: Node | null
  ) => HTMLElement,
  destroy: (key: string) => void,
  getDOM: (key: string) => HTMLElement
): void {
  const changed = new ChangedDOM(
    previousRuns.filter((run) => !run.clean).map((run) => run.first),
    slot,
    getDOM
  );
  const renderChild = (
    key: string,
    action: ChildAction,
    before: Node | null
  ): HTMLElement => {
    changed.remove(key);
    const dom = render(key, action, before);
    changed.track(key);
    return dom;
  };
  const destroyChild = (key: string): void => {
    changed.remove(key);
    destroy(key);
  };
  const previous = new Cursor(previousRuns, index);
  const next = new Cursor(nextRuns, index);
  let before: Node | null = slot.getFirstChild();
  while (!previous.done && !next.done) {
    const oldKey = previous.key(),
      key = next.key();
    if (oldKey === key) {
      if (next.clean && previous.clean) {
        const count = Math.min(previous.remaining, next.remaining);
        before = getNextSibling(getDOM(next.key(count - 1)));
        previous.advance(count);
        next.advance(count);
      } else {
        before = getNextSibling(renderChild(key, 'equal', before));
        previous.advance();
        next.advance();
      }
    } else if (
      reconcilerState.activeNextNodeMap.get(oldKey)?.__parent !== parent
    ) {
      const oldDOM = getDOM(oldKey);
      // A preceding parent pass may already have reused this moved child's
      // DOM. Its new siblings belong to that other slot, not this cursor.
      if (oldDOM.parentNode === slot.element) before = getNextSibling(oldDOM);
      destroyChild(oldKey);
      previous.advance();
    } else if (
      reconcilerState.activePrevNodeMap.get(key)?.__parent !== parent
    ) {
      renderChild(key, 'create', before);
      next.advance();
    } else if (next.clean) {
      const count = Math.min(previous.remaining, next.remaining);
      before = moveCleanRun(
        getDOM(key),
        getDOM(next.key(count - 1)),
        before,
        changed,
        slot,
        getDOM
      );
      previous.advance(count);
      next.advance(count);
    } else {
      before = getNextSibling(renderChild(key, 'move', before));
      previous.advance();
      next.advance();
    }
  }
  while (!next.done) {
    if (next.clean) {
      before = moveCleanRun(
        getDOM(next.key()),
        getDOM(next.key(next.remaining - 1)),
        before,
        changed,
        slot,
        getDOM
      );
      next.advance(next.remaining);
    } else {
      renderChild(next.key(), 'create', before);
      next.advance();
    }
  }
  while (!previous.done) {
    if (previous.clean) previous.advance(previous.remaining);
    else {
      const key = previous.key();
      if (reconcilerState.activeNextNodeMap.get(key)?.__parent !== parent)
        destroyChild(key);
      previous.advance();
    }
  }
}

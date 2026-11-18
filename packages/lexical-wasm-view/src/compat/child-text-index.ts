/** View-only ordered aggregates; never a second editor graph. */
export interface ChildText {
  key: string;
  text: string;
  firstText: string | null;
}
class Entry {
  left: Entry | null = null;
  right: Entry | null = null;
  parent: Entry | null = null;
  height = 1;
  size = 1;
  text: string;
  firstText: string | null;
  constructor(public value: ChildText) {
    this.text = value.text;
    this.firstText = value.firstText;
  }
}
const height = (entry: Entry | null) => entry?.height ?? 0;
const size = (entry: Entry | null) => entry?.size ?? 0;
function refresh(entry: Entry): Entry {
  entry.height = 1 + Math.max(height(entry.left), height(entry.right));
  entry.size = 1 + size(entry.left) + size(entry.right);
  entry.text =
    (entry.left?.text ?? '') + entry.value.text + (entry.right?.text ?? '');
  entry.firstText =
    entry.left?.firstText ??
    entry.value.firstText ??
    entry.right?.firstText ??
    null;
  if (entry.left) entry.left.parent = entry;
  if (entry.right) entry.right.parent = entry;
  return entry;
}
function rotateLeft(entry: Entry): Entry {
  const next = entry.right;
  if (!next) throw new Error('Missing right child in child aggregate rotation');
  entry.right = next.left;
  next.left = refresh(entry);
  return refresh(next);
}
function rotateRight(entry: Entry): Entry {
  const next = entry.left;
  if (!next) throw new Error('Missing left child in child aggregate rotation');
  entry.left = next.right;
  next.right = refresh(entry);
  return refresh(next);
}
function balance(entry: Entry): Entry {
  refresh(entry);
  if (height(entry.left) - height(entry.right) > 1) {
    if (entry.left && height(entry.left.left) < height(entry.left.right))
      entry.left = rotateLeft(entry.left);
    return rotateRight(entry);
  }
  if (height(entry.right) - height(entry.left) > 1) {
    if (entry.right && height(entry.right.right) < height(entry.right.left))
      entry.right = rotateRight(entry.right);
    return rotateLeft(entry);
  }
  return entry;
}
function insert(root: Entry | null, entry: Entry, index: number): Entry {
  if (!root) return entry;
  if (index <= size(root.left)) root.left = insert(root.left, entry, index);
  else root.right = insert(root.right, entry, index - size(root.left) - 1);
  return balance(root);
}
function remove(root: Entry, index: number): Entry | null {
  const leftSize = size(root.left);
  if (index < leftSize) {
    if (!root.left) throw new Error('Missing left aggregate');
    root.left = remove(root.left, index);
  } else if (index > leftSize) {
    if (!root.right) throw new Error('Missing right aggregate');
    root.right = remove(root.right, index - leftSize - 1);
  } else {
    if (!root.left) return root.right;
    if (!root.right) return root.left;
    let successor = root.right;
    while (successor.left) successor = successor.left;
    const right = remove(root.right, 0);
    successor.left = root.left;
    successor.right = right;
    return balance(successor);
  }
  return balance(root);
}
/** O(log siblings) edits and rank lookups; untouched child values stay shared. */
export class ChildTextIndex {
  private root: Entry | null = null;
  private readonly entries = new Map<string, Entry>();
  constructor(values: readonly ChildText[]) {
    const build = (start: number, end: number): Entry | null => {
      if (start === end) return null;
      const middle = (start + end) >>> 1;
      const entry = new Entry(values[middle]);
      this.entries.set(entry.value.key, entry);
      entry.left = build(start, middle);
      entry.right = build(middle + 1, end);
      return refresh(entry);
    };
    this.root = build(0, values.length);
  }
  get count(): number {
    return size(this.root);
  }
  get text(): string {
    return this.root?.text ?? '';
  }
  get firstText(): string | null {
    return this.root?.firstText ?? null;
  }
  has(key: string): boolean {
    return this.entries.has(key);
  }
  keyAt(index: number): string {
    let entry = this.root;
    while (entry) {
      const left = size(entry.left);
      if (index === left) return entry.value.key;
      if (index < left) entry = entry.left;
      else {
        index -= left + 1;
        entry = entry.right;
      }
    }
    throw new Error('Child aggregate index out of bounds');
  }
  rank(key: string): number {
    let entry = this.entries.get(key);
    if (!entry) throw new Error('Missing child aggregate for ' + key);
    let index = size(entry.left);
    while (entry.parent) {
      if (entry.parent.right === entry) index += 1 + size(entry.parent.left);
      entry = entry.parent;
    }
    return index;
  }
  set(value: ChildText): void {
    let entry = this.entries.get(value.key);
    if (!entry) throw new Error('Missing child aggregate for ' + value.key);
    entry.value = value;
    while (entry) {
      refresh(entry);
      entry = entry.parent ?? undefined;
    }
  }
  delete(key: string): void {
    if (!this.root || !this.entries.has(key)) return;
    this.root = remove(this.root, this.rank(key));
    if (this.root) this.root.parent = null;
    this.entries.delete(key);
  }
  insertAfter(value: ChildText, previous: string | null): void {
    this.delete(value.key);
    const index = previous === null ? 0 : this.rank(previous) + 1;
    const entry = new Entry(value);
    this.root = insert(this.root, entry, index);
    this.root.parent = null;
    this.entries.set(value.key, entry);
  }
}
export const childTextIndexes = new WeakMap<HTMLElement, ChildTextIndex>();
export const renderedChildText = new WeakMap<HTMLElement, ChildText>();

/**
 * In-place reconciliation: an edited block is changed inside the live
 * document rather than re-imported, so its node ids, the comment marks around
 * its text and the props markdown cannot carry survive, and concurrent typing
 * in it merges character by character.
 *
 * Ported from the ai-edit harness's mdpatch v1 committer.
 */
import {
  $createTextNode,
  $isElementNode,
  $isTextNode,
  $parseSerializedNode,
  type ElementFormatType,
  type ElementNode,
  type LexicalNode,
  type TextNode,
} from 'lexical';
import { blockSteps } from '../body';
import type { DocumentView, SerializedNode } from './document';
import { type RequestedBlock, similarity } from './edits';

export type AlignedBy = 'id' | 'exact' | 'fuzzy' | 'insert';

export interface Alignment {
  /** For each requested block, the base index it continues, or -1 (insert). */
  match: number[];
  how: AlignedBy[];
}

const FUZZY_MIN = 0.6;
const WEAK_HINT_MIN = 0.5;

/**
 * Align requested blocks to base blocks: by id (keep tokens, then the block an
 * edit came from), then equal markdown (LCS), then fuzzy (same type, similar
 * words, between aligned neighbours). The rest are inserts and deletes.
 */
export function alignBlocks(
  view: DocumentView,
  requested: RequestedBlock[]
): Alignment {
  const n = requested.length;
  const match = new Array<number>(n).fill(-1);
  const how = new Array<AlignedBy>(n).fill('insert');
  const used = new Set<number>();
  const byId = new Map(view.blocks.map((block, i) => [block.id, i]));
  const take = (j: number, i: number, by: AlignedBy) => {
    match[j] = i;
    how[j] = by;
    used.add(i);
  };
  const markdownOf = (j: number) => {
    const block = requested[j];
    return block.kind === 'markdown' ? block.markdown : '';
  };
  const typeOf = (j: number) => {
    const block = requested[j];
    return block.kind === 'markdown' ? block.node.type : '';
  };

  requested.forEach((block, j) => {
    if (block.kind !== 'keep') return;
    const i = byId.get(block.id);
    if (i !== undefined && !used.has(i)) take(j, i, 'id');
  });

  // Several blocks hinted with one id (an edit that split a block): exact
  // markdown wins, else the most similar of the same type.
  const hinted = new Map<number, number[]>();
  requested.forEach((block, j) => {
    if (block.kind !== 'markdown' || block.hint === undefined) return;
    const i = byId.get(block.hint);
    if (i === undefined || used.has(i) || view.blocks[i].opaque) return;
    hinted.set(i, [...(hinted.get(i) ?? []), j]);
  });
  for (const [i, js] of hinted) {
    const base = view.blocks[i];
    const typed = js.filter((j) => typeOf(j) === base.type);
    const pool = typed.length ? typed : js;
    const pick =
      js.find((j) => markdownOf(j) === base.markdown) ??
      pool.reduce((best, j) =>
        similarity(base.markdown, markdownOf(j)) >
        similarity(base.markdown, markdownOf(best))
          ? j
          : best
      );
    take(pick, i, 'id');
  }

  // Weak hints (an edit spanning several blocks): same type and similar.
  const weak: [score: number, i: number, j: number][] = [];
  requested.forEach((block, j) => {
    if (block.kind !== 'markdown' || !block.hints || match[j] >= 0) return;
    for (const id of block.hints) {
      const i = byId.get(id);
      if (
        i === undefined ||
        used.has(i) ||
        view.blocks[i].type !== block.node.type
      )
        continue;
      const score =
        view.blocks[i].markdown === block.markdown
          ? 2
          : similarity(view.blocks[i].markdown, block.markdown);
      if (score >= WEAK_HINT_MIN) weak.push([score, i, j]);
    }
  });
  weak.sort((a, b) => b[0] - a[0]);
  for (const [, i, j] of weak)
    if (!used.has(i) && match[j] < 0) take(j, i, 'id');

  const freeBase = view.blocks
    .map((_, i) => i)
    .filter((i) => !used.has(i) && !view.blocks[i].opaque);
  const freeRequested = requested
    .map((_, j) => j)
    .filter((j) => match[j] < 0 && requested[j].kind === 'markdown');
  let q = 0;
  for (const step of blockSteps(
    freeBase.map((i) => view.blocks[i].markdown),
    freeRequested.map(markdownOf)
  )) {
    if (step.kind === 'keep')
      take(freeRequested[q++], freeBase[step.current], 'exact');
    else if (step.kind === 'insert') q++;
  }

  for (let j = 0; j < n; j++) {
    if (match[j] >= 0 || requested[j].kind !== 'markdown') continue;
    let low = -1;
    for (let k = j - 1; k >= 0; k--)
      if (match[k] >= 0) {
        low = match[k];
        break;
      }
    let high = view.blocks.length;
    for (let k = j + 1; k < n; k++)
      if (match[k] >= 0) {
        high = match[k];
        break;
      }
    let best = -1;
    let bestScore = FUZZY_MIN;
    for (let i = low + 1; i < high; i++) {
      const base = view.blocks[i];
      if (used.has(i) || base.opaque || base.type !== typeOf(j)) continue;
      const score = similarity(base.markdown, markdownOf(j));
      if (score >= bestScore) {
        best = i;
        bestScore = score;
      }
    }
    if (best >= 0) take(j, best, 'fuzzy');
  }
  return { match, how };
}

export interface ReconcileCounters {
  textEdits: number;
  replaced: number;
}

/** Element props written by the dedicated setters or not part of the content. */
const SKIP_PROPS = new Set([
  'type',
  'version',
  'children',
  '$',
  'direction',
  'textFormat',
  'textStyle',
  'text',
  'format',
  'style',
  'detail',
  'mode',
]);
const COMPARE_SKIP = new Set(['$', 'style', 'direction', 'textStyle']);

function stripForCompare(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripForCompare);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value))
    if (!COMPARE_SKIP.has(key)) out[key] = stripForCompare(inner);
  return out;
}
const exactKey = (node: SerializedNode) =>
  JSON.stringify(stripForCompare(node));
const isText = (node: SerializedNode) =>
  node.type === 'text' || node.type === 'code-highlight';
const kindOf = (node: SerializedNode) =>
  isText(node) ? `${node.type}|${node.format ?? 0}` : node.type;
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Lexical keeps a node's props as `__name` fields on its writable copy. */
type WritableProps = Record<string, unknown>;
const writable = (node: LexicalNode) =>
  node.getWritable() as unknown as WritableProps;

interface Item {
  node: LexicalNode;
  serialized: SerializedNode;
}

/** Children as alignment items, comment-mark wrappers flattened away. */
function itemsOf(
  node: LexicalNode,
  serialized: SerializedNode,
  marks: ElementNode[]
): Item[] {
  const items: Item[] = [];
  const children = $isElementNode(node) ? node.getChildren() : [];
  const serializedChildren = serialized.children ?? [];
  children.forEach((child, i) => {
    const childSerialized = serializedChildren[i];
    if (!childSerialized) return;
    if (childSerialized.type === 'comment-mark' && $isElementNode(child)) {
      marks.push(child);
      items.push(...itemsOf(child, childSerialized, marks));
    } else items.push({ node: child, serialized: childSerialized });
  });
  return items;
}

/**
 * Reconcile live `node` (serialized as `before`) to `after`. Returns false
 * when it has to be replaced instead (a type change, a prop with no field).
 */
export function reconcile(
  node: LexicalNode,
  before: SerializedNode,
  after: SerializedNode,
  counters: ReconcileCounters
): boolean {
  if (before.type !== after.type) return false;
  if (isText(before) && $isTextNode(node)) {
    if (before.text !== after.text) {
      node.setTextContent(after.text);
      counters.textEdits++;
    }
    if ((before.format ?? 0) !== (after.format ?? 0))
      node.setFormat(Number(after.format ?? 0));
    return true;
  }
  if (!Array.isArray(before.children) || !Array.isArray(after.children)) {
    if (Array.isArray(before.children) !== Array.isArray(after.children))
      return false;
    // A decorator or leaf: write differing props in place (image alt, card
    // name…); the per-block verify catches anything this misses.
    if (exactKey(before) === exactKey(after)) return true;
    // Markdown carries only a media node's alt (and a plain link's url):
    // srcType, upload id and sizes are not markdown.
    const media = before.type === 'image' || before.type === 'video';
    const props = writable(node);
    for (const key of new Set([
      ...Object.keys(before),
      ...Object.keys(after),
    ])) {
      if (key === 'type' || key === 'version' || key === '$') continue;
      if (media && key !== 'alt' && key !== 'url') continue;
      if (same(before[key], after[key])) continue;
      if (
        media &&
        key === 'url' &&
        (before.srcType === 'dss' || String(before.url).startsWith('data:'))
      )
        return false;
      if (!(`__${key}` in props)) return false;
      props[`__${key}`] = after[key];
    }
    return true;
  }
  if (!$isElementNode(node)) return false;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (SKIP_PROPS.has(key) || same(before[key], after[key])) continue;
    const props = writable(node);
    if (!(`__${key}` in props)) return false;
    props[`__${key}`] = after[key];
  }
  if (
    before.type !== 'custom-code' &&
    (before.format ?? '') !== (after.format ?? '')
  )
    node.setFormat((after.format ?? '') as ElementFormatType);
  reconcileChildren(node, before, after, counters);
  return true;
}

function reconcileChildren(
  node: ElementNode,
  before: SerializedNode,
  after: SerializedNode,
  counters: ReconcileCounters
): void {
  const marks: ElementNode[] = [];
  const olds = itemsOf(node, before, marks);
  const news = after.children;
  // 1. Exact subtree matches (LCS) anchor the alignment.
  const pairOf = new Array<number>(news.length).fill(-1); // new j -> old i
  const spliced = new Array<boolean>(news.length).fill(false);
  const spliceTail = new Map<number, LexicalNode>();
  let q = 0;
  for (const step of blockSteps(
    olds.map((item) => exactKey(item.serialized)),
    news.map(exactKey)
  )) {
    if (step.kind === 'keep') pairOf[q++] = step.current;
    else if (step.kind === 'insert') q++;
  }
  const exact = new Set(pairOf.filter((i) => i >= 0));
  const usedOld = new Set(exact);

  // 2. Each gap between anchors: a text-only gap is spliced across its
  //    existing runs; otherwise non-text nodes pair by kind, then in order.
  const processGap = (
    oldFrom: number,
    oldTo: number,
    newFrom: number,
    newTo: number,
    level: number
  ): void => {
    const oldGap = olds.slice(oldFrom + 1, oldTo);
    const newGap = news.slice(newFrom + 1, newTo);
    if (!oldGap.length && !newGap.length) return;
    if (
      oldGap.length &&
      oldGap.every((item) => isText(item.serialized)) &&
      newGap.every(isText) &&
      spliceRuns(oldGap, newGap, counters)
    ) {
      for (let i = oldFrom + 1; i < oldTo; i++) usedOld.add(i);
      const tail = oldGap.filter((item) => item.node.isAttached()).at(-1)?.node;
      for (let j = newFrom + 1; j < newTo; j++) {
        spliced[j] = true;
        if (tail) spliceTail.set(j, tail);
      }
      return;
    }
    if (level === 0) {
      const oldIdx: number[] = [];
      const newIdx: number[] = [];
      for (let i = oldFrom + 1; i < oldTo; i++)
        if (!isText(olds[i].serialized)) oldIdx.push(i);
      for (let j = newFrom + 1; j < newTo; j++)
        if (!isText(news[j])) newIdx.push(j);
      const subs: [number, number][] = [];
      let qq = 0;
      for (const step of blockSteps(
        oldIdx.map((i) => kindOf(olds[i].serialized)),
        newIdx.map((j) => kindOf(news[j]))
      )) {
        if (step.kind === 'keep')
          subs.push([oldIdx[step.current], newIdx[qq++]]);
        else if (step.kind === 'insert') qq++;
      }
      if (subs.length) {
        for (const [i, j] of subs) {
          pairOf[j] = i;
          usedOld.add(i);
        }
        const points: [number, number][] = [
          [oldFrom, newFrom],
          ...subs,
          [oldTo, newTo],
        ];
        for (let g = 0; g + 1 < points.length; g++)
          processGap(
            points[g][0],
            points[g + 1][0],
            points[g][1],
            points[g + 1][1],
            1
          );
        return;
      }
    }
    // Pair in order by node type: a text run whose format changed (a word
    // bolded inside a comment mark) is reformatted in place, keeping its mark.
    let last = oldFrom;
    for (let j = newFrom + 1; j < newTo; j++)
      for (let i = last + 1; i < oldTo; i++) {
        if (usedOld.has(i) || olds[i].serialized.type !== news[j].type)
          continue;
        pairOf[j] = i;
        usedOld.add(i);
        last = i;
        break;
      }
  };
  const anchors: [number, number][] = [[-1, -1]];
  pairOf.forEach((i, j) => {
    if (i >= 0) anchors.push([i, j]);
  });
  anchors.push([olds.length, news.length]);
  for (let g = 0; g + 1 < anchors.length; g++)
    processGap(
      anchors[g][0],
      anchors[g + 1][0],
      anchors[g][1],
      anchors[g + 1][1],
      0
    );

  // 3. Removals, then reconcile or insert in the new order.
  for (let i = 0; i < olds.length; i++)
    if (!usedOld.has(i)) olds[i].node.remove();
  let previous: LexicalNode | undefined;
  for (let j = 0; j < news.length; j++) {
    if (spliced[j]) {
      if (spliceTail.has(j)) previous = spliceTail.get(j);
      continue;
    }
    const i = pairOf[j];
    let current: LexicalNode;
    if (i >= 0) {
      current = olds[i].node;
      if (
        !exact.has(i) &&
        !reconcile(current, olds[i].serialized, news[j], counters)
      ) {
        const fresh = $parseSerializedNode(news[j]);
        current.replace(fresh);
        current = fresh;
        counters.replaced++;
      }
    } else {
      current = $parseSerializedNode(news[j]);
      const mark = previous?.getParent();
      if (
        previous &&
        mark?.getType() === 'comment-mark' &&
        mark.getLastChild() === previous
      )
        // A new run after a mark's last run goes beside the mark: the
        // comment never grows to cover text its author did not quote.
        mark.insertAfter(current);
      else if (previous) previous.insertAfter(current);
      else {
        const firstOld = olds.find(
          (item, k) => usedOld.has(k) && item.node.isAttached()
        )?.node;
        if (firstOld) firstOld.insertBefore(current);
        else node.append(current);
      }
    }
    previous = current;
  }
  for (const mark of marks)
    if (mark.isAttached() && mark.getChildrenSize() === 0) mark.remove();
}

const formatOf = (node: SerializedNode) =>
  node.type === 'code-highlight' ? 'code' : String(node.format ?? 0);
const inMark = (node: LexicalNode) =>
  node.getParent()?.getType() === 'comment-mark';

/**
 * Splice a text-only gap: keep the old runs, cut the changed middle (common
 * prefix and suffix by character and format) and put the new middle into one
 * existing run of its format. Inserted text joins the left run unless that run
 * is inside a comment mark and the right one is not, so new text joins a mark
 * only from inside it; text inserted just before a mark from outside it gets a
 * run of its own before the mark. False (the caller falls back) when the new middle mixes
 * formats or no run has its format.
 */
function spliceRuns(
  oldGap: Item[],
  newGap: SerializedNode[],
  counters: ReconcileCounters
): boolean {
  type Char = { c: string; format: string; run: number };
  const oldChars: Char[] = [];
  oldGap.forEach((item, run) => {
    for (const c of item.serialized.text ?? '')
      oldChars.push({ c, format: formatOf(item.serialized), run });
  });
  const newChars: { c: string; format: string }[] = [];
  for (const node of newGap)
    for (const c of node.text ?? '')
      newChars.push({ c, format: formatOf(node) });
  const sameChar = (
    a: { c: string; format: string },
    b: { c: string; format: string }
  ) => a.c === b.c && a.format === b.format;
  let prefix = 0;
  while (
    prefix < oldChars.length &&
    prefix < newChars.length &&
    sameChar(oldChars[prefix], newChars[prefix])
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < oldChars.length - prefix &&
    suffix < newChars.length - prefix &&
    sameChar(
      oldChars[oldChars.length - 1 - suffix],
      newChars[newChars.length - 1 - suffix]
    )
  )
    suffix++;
  const insert = newChars.slice(prefix, newChars.length - suffix);
  if (new Set(insert.map((ch) => ch.format)).size > 1) return false;
  const format = insert[0]?.format;
  const left = prefix > 0 ? oldChars[prefix - 1].run : -1;
  const right = suffix > 0 ? oldChars[oldChars.length - suffix].run : -1;
  let host = -1;
  if (insert.length) {
    const fits = (run: number) =>
      run >= 0 && formatOf(oldGap[run].serialized) === format;
    if (fits(left) && fits(right))
      host =
        inMark(oldGap[left].node) && !inMark(oldGap[right].node) ? right : left;
    else if (fits(left)) host = left;
    else if (fits(right)) host = right;
    else {
      const cut = oldChars
        .slice(prefix, oldChars.length - suffix)
        .find((ch) => ch.format === format);
      if (cut) host = cut.run;
      // A pure insertion in a format no run has (new bold text): a run of its
      // own, placed below.
      else if (prefix + suffix !== oldChars.length || format === 'code')
        return false;
    }
  }
  const inserted = insert.map((ch) => ch.c).join('');
  // Text inserted at a comment mark's start from outside it must not extend
  // the mark: it goes into a run of its own just before the mark.
  let standalone: { place: () => void } | null = null;
  if (insert.length && host < 0) {
    const text = $createTextNode(inserted);
    text.setFormat(Number(format));
    const leftNode = left >= 0 ? oldGap[left].node : null;
    const rightNode = right >= 0 ? oldGap[right].node : null;
    const sameParent =
      leftNode && rightNode && leftNode.getParent() === rightNode.getParent();
    standalone = {
      place: () => {
        if (leftNode) {
          const mark = leftNode.getParent();
          if (
            inMark(leftNode) &&
            !sameParent &&
            mark?.getLastChild() === leftNode
          )
            mark.insertAfter(text);
          else leftNode.insertAfter(text);
        } else if (rightNode) {
          const mark = rightNode.getParent();
          if (inMark(rightNode) && mark?.getFirstChild() === rightNode)
            mark.insertBefore(text);
          else rightNode.insertBefore(text);
        }
      },
    };
    if (!leftNode && !rightNode) return false;
  }
  if (
    host >= 0 &&
    host === right &&
    host !== left &&
    inMark(oldGap[right].node) &&
    (left < 0 ||
      oldGap[left].node.getParent() !== oldGap[right].node.getParent()) &&
    // Replacing marked text keeps the replacement in the mark.
    !oldChars
      .slice(prefix, oldChars.length - suffix)
      .some(
        (ch) =>
          oldGap[ch.run].node.getParent() === oldGap[right].node.getParent()
      )
  ) {
    const anchor = oldGap[right].node;
    const mark = anchor.getParent();
    if (!$isTextNode(anchor) || anchor.getType() !== 'text' || !mark)
      return false;
    if (mark.getFirstChild() !== anchor) return false;
    const text = $createTextNode(inserted);
    text.setFormat(anchor.getFormat());
    text.setStyle(anchor.getStyle());
    standalone = { place: () => mark.insertBefore(text) };
    host = -1;
  }
  const texts = oldGap.map(() => '');
  let placed = false;
  for (let k = 0; k <= oldChars.length; k++) {
    if (k === prefix && !placed && host >= 0) {
      texts[host] += inserted;
      placed = true;
    }
    if (k === oldChars.length) break;
    if (k >= prefix && k < oldChars.length - suffix) continue;
    texts[oldChars[k].run] += oldChars[k].c;
  }
  if (host >= 0 && !placed) texts[host] += inserted;
  if (standalone) {
    standalone.place();
    counters.textEdits++;
  }
  oldGap.forEach((item, run) => {
    if (texts[run] === item.serialized.text) return;
    const text = item.node as TextNode;
    if (texts[run] === '') text.remove();
    else text.setTextContent(texts[run]);
    counters.textEdits++;
  });
  return true;
}

/** Serialize a live node with its whole subtree (exportJSON is shallow). */
export function serializeDeep(node: LexicalNode): SerializedNode {
  const json = node.exportJSON() as SerializedNode;
  if ($isElementNode(node))
    json.children = node.getChildren().map(serializeDeep);
  return json;
}

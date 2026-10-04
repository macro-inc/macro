import type { LoroDoc, LoroMap } from 'loro-crdt';
import type { DocxPackageState } from './docx-package';
import { compareKeyed, keysBetween } from './fractional-index';

/**
 * Root containers of a collaborative DOCX. Every root is a flat map so two
 * peers editing different blocks, parts, or comment marks never conflict;
 * concurrent writes to the same key resolve last-writer-wins.
 */
export const DOCX_LORO_CONTAINERS = {
  meta: 'docxMeta',
  blocks: 'docxBlocks',
  order: 'docxOrder',
  parts: 'docxParts',
  marks: 'docxMarks',
} as const;

export const DOCX_FORMAT_VERSION = 1;

function container(doc: LoroDoc, name: string): LoroMap {
  return doc.getMap(name);
}

function stringEntries(map: LoroMap): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const key of map.keys()) {
    const value = map.get(key);
    if (typeof value === 'string') out.push([key, value]);
  }
  return out;
}

export function docxFormatVersion(doc: LoroDoc): number | undefined {
  const value = container(doc, DOCX_LORO_CONTAINERS.meta).get('formatVersion');
  return typeof value === 'number' ? value : undefined;
}

/** True once a peer has seeded the document body. */
export function isDocxSeeded(doc: LoroDoc): boolean {
  return docxFormatVersion(doc) !== undefined;
}

export type OrderKeys = ReadonlyMap<string, string>;

/** The current block order keys, for computing a minimal reorder. */
export function readOrderKeys(doc: LoroDoc): Map<string, string> {
  return new Map(stringEntries(container(doc, DOCX_LORO_CONTAINERS.order)));
}

/**
 * The document the collaborative state describes. A block is visible only
 * when it has both content and a position; a half-written block (possible
 * mid-merge after a concurrent delete) is skipped rather than guessed at.
 */
export function readDocxState(doc: LoroDoc): DocxPackageState {
  const blocks = new Map(
    stringEntries(container(doc, DOCX_LORO_CONTAINERS.blocks))
  );
  const keyed = stringEntries(container(doc, DOCX_LORO_CONTAINERS.order))
    .filter(([id]) => blocks.has(id))
    .map(([id, key]) => ({ id, key }))
    .sort(compareKeyed);
  return {
    order: keyed.map((entry) => entry.id),
    blocks,
    parts: new Map(stringEntries(container(doc, DOCX_LORO_CONTAINERS.parts))),
  };
}

/** Write a freshly split package as the initial collaborative state. */
export function seedDocxState(doc: LoroDoc, state: DocxPackageState) {
  const blocks = container(doc, DOCX_LORO_CONTAINERS.blocks);
  const order = container(doc, DOCX_LORO_CONTAINERS.order);
  const parts = container(doc, DOCX_LORO_CONTAINERS.parts);
  const keys = keysBetween(null, null, state.order.length);
  state.order.forEach((id, index) => {
    blocks.set(id, state.blocks.get(id) ?? '');
    order.set(id, keys[index]);
  });
  for (const [name, value] of state.parts) parts.set(name, value);
  container(doc, DOCX_LORO_CONTAINERS.meta).set(
    'formatVersion',
    DOCX_FORMAT_VERSION
  );
  doc.commit({ origin: 'docx-seed' });
}

export type DocxChanges = {
  /** Blocks whose content was created or changed. */
  upserts: ReadonlyMap<string, string>;
  /** Blocks removed from the document. */
  removed: readonly string[];
  /** The complete new block order, when it changed. */
  order?: readonly string[];
  /** Parts created or changed (string) or removed (null). */
  parts: ReadonlyMap<string, string | null>;
};

export function hasChanges(changes: DocxChanges): boolean {
  return (
    changes.upserts.size > 0 ||
    changes.removed.length > 0 ||
    changes.order !== undefined ||
    changes.parts.size > 0
  );
}

/** Indices of a longest strictly increasing subsequence of `values`. */
function longestIncreasing(values: readonly string[]): Set<number> {
  const tails: number[] = [];
  const previous = new Array<number>(values.length).fill(-1);
  values.forEach((value, index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (values[tails[mid]] < value) low = mid + 1;
      else high = mid;
    }
    if (low > 0) previous[index] = tails[low - 1];
    tails[low] = index;
  });
  const keep = new Set<number>();
  let cursor = tails.length ? tails[tails.length - 1] : -1;
  while (cursor >= 0) {
    keep.add(cursor);
    cursor = previous[cursor];
  }
  return keep;
}

/**
 * Position keys for `order` that reuse as many existing keys as possible:
 * blocks already in relative order keep their keys; moved and new blocks get
 * fresh keys between their kept neighbours. Returns only keys that change.
 */
export function reorderKeys(
  existing: OrderKeys,
  order: readonly string[]
): Map<string, string> {
  const current = order.map((id) => existing.get(id));
  const candidates: number[] = [];
  current.forEach((key, index) => {
    if (key !== undefined) candidates.push(index);
  });
  // Ties between concurrently minted keys break by id, matching readDocxState.
  const sortable = candidates.map(
    (index) => `${current[index]}\u0000${order[index]}`
  );
  const keptCandidates = longestIncreasing(sortable);
  const kept = new Set<number>();
  let previousKey: string | undefined;
  candidates.forEach((index, i) => {
    if (!keptCandidates.has(i)) return;
    // Concurrent peers can mint the same key; re-key the later block so new
    // keys always have a strictly ordered pair of neighbours.
    if (current[index] === previousKey) return;
    previousKey = current[index];
    kept.add(index);
  });

  const changed = new Map<string, string>();
  let index = 0;
  while (index < order.length) {
    if (kept.has(index)) {
      index++;
      continue;
    }
    const runStart = index;
    while (index < order.length && !kept.has(index)) index++;
    const low = runStart > 0 ? (current[runStart - 1] ?? null) : null;
    const high = index < order.length ? (current[index] ?? null) : null;
    const keys = keysBetween(low, high, index - runStart);
    for (let i = runStart; i < index; i++) {
      const key = keys[i - runStart];
      current[i] = key;
      changed.set(order[i], key);
    }
  }
  return changed;
}

/** Apply local document changes to the collaborative state in one commit. */
export function writeDocxChanges(doc: LoroDoc, changes: DocxChanges) {
  if (!hasChanges(changes)) return;
  const blocks = container(doc, DOCX_LORO_CONTAINERS.blocks);
  const order = container(doc, DOCX_LORO_CONTAINERS.order);
  const parts = container(doc, DOCX_LORO_CONTAINERS.parts);
  for (const [id, xml] of changes.upserts) blocks.set(id, xml);
  for (const id of changes.removed) {
    blocks.delete(id);
    order.delete(id);
  }
  if (changes.order) {
    const existing = readOrderKeys(doc);
    // A block another peer deleted concurrently stays deleted unless this
    // peer also changed its content.
    const ordered = changes.order.filter(
      (id) => existing.has(id) || changes.upserts.has(id)
    );
    for (const [id, key] of reorderKeys(existing, ordered)) order.set(id, key);
  }
  for (const [name, value] of changes.parts) {
    if (value === null) parts.delete(name);
    else parts.set(name, value);
  }
  doc.commit({ origin: 'docx-edit' });
}

/** Changes that turn `before` into `after`. */
export function diffDocxStates(
  before: DocxPackageState,
  after: DocxPackageState
): DocxChanges {
  const upserts = new Map<string, string>();
  for (const id of after.order) {
    const xml = after.blocks.get(id);
    if (xml !== undefined && before.blocks.get(id) !== xml)
      upserts.set(id, xml);
  }
  const present = new Set(after.order);
  const removed = before.order.filter((id) => !present.has(id));
  const orderChanged =
    before.order.length !== after.order.length ||
    before.order.some((id, index) => after.order[index] !== id);
  const parts = new Map<string, string | null>();
  for (const [name, value] of after.parts)
    if (before.parts.get(name) !== value) parts.set(name, value);
  for (const name of before.parts.keys())
    if (!after.parts.has(name)) parts.set(name, null);
  return {
    upserts,
    removed,
    order: orderChanged ? after.order : undefined,
    parts,
  };
}
